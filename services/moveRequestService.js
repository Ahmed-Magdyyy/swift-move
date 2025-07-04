// services/moveRequestService.js
const mongoose = require("mongoose");
const Move = require("../models/moveModel");
const Driver = require("../models/driverModel");
const User = require("../models/userModel");
const pricingService = require("./pricingService");
const googleMapsService = require("./googleMapsService");
const trackingService = require("./trackingService");
const { moveStatus, roles } = require("../utils/Constant/enum");
const ApiError = require("../utils/ApiError");

const MAX_DRIVER_SEARCH_ATTEMPTS = 3;
const DRIVER_RESPONSE_TIMEOUT = 90000; // 90 seconds

class MoveRequestService {
  constructor() {
    this.pendingDriverNotifications = new Map();
  }

  async initiateNewMove(customerId, moveData) {
    // 1. Check if the customer already has an active move
    const terminalStates = [
      moveStatus.DELIVERED,
      moveStatus.CANCELLED_BY_ADMIN,
      moveStatus.CANCELLED_BY_CUSTOMER,
      moveStatus.CANCELLED_BY_DRIVER,
      moveStatus.NO_DRIVERS_AVAILABLE,
    ];

    const existingMove = await Move.findOne({
      customer: customerId,
      status: { $nin: terminalStates },
    });

    if (existingMove) {
      throw new ApiError(
        "You already have an active move. You cannot create a new one until the current move is completed or cancelled.",
        409
      );
    }

    const { pickup, delivery, items, vehicleType, scheduledFor } = moveData;
    const session = await mongoose.startSession();
    let move;

    try {
      await session.withTransaction(async () => {
        // Verify customer exists
        const customer = await User.findById(customerId).session(session);
        if (!customer) throw new ApiError("Customer not found.", 404);

        // Calculate pricing
        const pricingDetails = await pricingService.calculateMovePrice(
          pickup,
          delivery,
          vehicleType
        );

        // Create the move
        move = new Move({
          customer: customerId,
          pickup,
          delivery,
          items,
          vehicleType,
          scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
          pricing: {
            basePrice: pricingDetails.basePrice,
            distancePrice: pricingDetails.distancePrice,
            totalPrice: pricingDetails.totalPrice,
          },
          status: moveStatus.PENDING,
          routePolyline: pricingDetails.polyline,
        });

        await move.save({ session });

        // If this is a scheduled move for the future, just save it and notify
        if (
          move.scheduledFor &&
          move.scheduledFor > new Date(Date.now() + 5 * 60 * 1000)
        ) {
          trackingService.notifyCustomer(customerId, "move:scheduled", {
            moveId: move._id.toString(),
            scheduledFor: move.scheduledFor,
            message: "Your move has been scheduled.",
          });
          return;
        }

        await this._findAndNotifyDrivers(move, session);
      });

      return move ? move.toObject() : null;
    } catch (error) {
      console.error("Error in initiateNewMove:", error);

      // Notify customer of failure
      if (customerId) {
        trackingService.notifyCustomer(customerId, "move:creation_failed", {
          reason: error.message || "Failed to create move request",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }

      // Re-throw ApiError as is, wrap others
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to initiate new move: ${error.message}`, 500);
    } finally {
      try {
        await session.endSession();
      } catch (e) {
        console.error("Error ending session in initiateNewMove:", e);
      }
    }
  }

  async _findAndNotifyDrivers(
    move,
    session,
    attempt = 1,
    excludedDriverIds = []
  ) {
    const pickupCoords = move.pickup.coordinates.coordinates;
    const vehicleType = move.vehicleType;

    try {
      // Fetch all nearby drivers
      const allNearbyDrivers =
        (await googleMapsService.getNearbyDrivers(
          pickupCoords,
          vehicleType,
          5000
        )) || [];

      // Manually filter out drivers who have already been excluded in previous attempts
      const nearbyDrivers = allNearbyDrivers.filter(
        (driver) => !excludedDriverIds.includes(driver.driverId)
      );

      if (!nearbyDrivers || nearbyDrivers.length === 0) {
        if (attempt === 1) {
          move.status = moveStatus.NO_DRIVERS_AVAILABLE;
          await move.save({ session });
          await session.commitTransaction();
          trackingService.notifyCustomer(
            move.customer.toString(),
            "move:no_drivers_found",
            {
              moveId: move._id.toString(),
              message: "No available drivers found in your area.",
            }
          );
        } else {
          await session.commitTransaction();
        }
        return;
      }

      // Save the move with updated status if this is the first attempt
      if (attempt === 1) {
        move.status = moveStatus.PENDING;
        await move.save({ session });
      }

      // Notify the first available driver
      const driverToNotify = nearbyDrivers[0];
      const notificationState = {
        moveId: move._id.toString(),
        attempt: 1,
        currentDriverId: driverToNotify.driverId, // The Driver document ID
        currentDriverUserId: driverToNotify.driverUserId, // The User document ID
        excludedDriverIds: [driverToNotify.driverId], // Exclude by Driver ID
        timeoutId: setTimeout(
          () => this.handleDriverResponseTimeout(move._id.toString()),
          DRIVER_RESPONSE_TIMEOUT
        ),
      };

      this.pendingDriverNotifications.set(move._id.toString(), notificationState);

      // Send notification to the driver's user room
      trackingService.notifyDriver(
        driverToNotify.driverUserId,
        "driver:new_move_request",
        {
          move: move.toObject(),
          pickupLocation: move.pickup,
          deliveryLocation: move.delivery,
          vehicleType: move.vehicleType,
          price: move.pricing.totalPrice,
        }
      );

      // Don't commit the transaction here - it will be committed when the driver responds or times out
    } catch (error) {
      console.error("Error in _findAndNotifyDrivers:", error);
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw error;
    }
  }

  async handleDriverResponseTimeout(moveId) {
    const notificationState = this.pendingDriverNotifications.get(moveId);
    if (!notificationState) {
      console.log(
        `[MoveRequestService] Timeout for move ${moveId} triggered, but no pending notification found. It was likely handled.`
      );
      return;
    }

    console.log(
      `Driver ${notificationState.currentDriverId} (user: ${notificationState.currentDriverUserId}) did not respond to move ${moveId} within timeout period.`
    );

    // The timeout has already fired, but we clear it from the state to be safe.
    clearTimeout(notificationState.timeoutId);

    try {
      // Delegate to the rejection handler. Pass the driver's USER ID.
      await this.handleDriverRejection(
        moveId,
        notificationState.currentDriverUserId,
        'timeout'
      );
    } catch (error) {
      console.error(
        `Error in handleDriverResponseTimeout for move ${moveId}:`,
        error
      );
    }
  }

  async acceptMoveRequest(moveId, driverUserId) {
    const session = await mongoose.startSession();
    let move, driver, notificationState, route;

    try {
      await session.withTransaction(async () => {
        // Get the move with the customer populated
        move = await Move.findById(moveId)
          .populate("customer", "_id name email phone image")
          .session(session);
        if (!move) throw new ApiError("Move not found.", 404);

        // Check if the move can be accepted
        if (move.status !== moveStatus.PENDING) {
          throw new ApiError(
            "Move is not pending and cannot be accepted.",
            409
          );
        }

        if (move.driver) {
          throw new ApiError("Move already has a driver assigned.", 409);
        }

        // Get the driver with user populated
        driver = await Driver.findOne({ user: driverUserId })
          .populate("user")
          .session(session);
        if (!driver) {
          throw new ApiError("Driver not found.", 404);
        }

        if (!driver.isAvailable || driver.status !== "accepted") {
          throw new ApiError("Driver is not available or not accepted.", 400);
        }

        if (driver.vehicle.type !== move.vehicleType) {
          throw new ApiError(
            "Driver vehicle type does not match requested type.",
            400
          );
        }

        // Update the move with the driver
        move.driver = driver._id;
        move.status = moveStatus.ACCEPTED;
        if (!move.actualTime) move.actualTime = {};
        driver.isAvailable = false;

       move= await move.save({ session });
        await driver.save({ session });

        // Get the notification state before we commit the transaction
        notificationState = this.pendingDriverNotifications.get(moveId);
      });

      // If we get here, the transaction was successful
      // Now clean up any pending notifications
      if (notificationState) {
        if (notificationState.timeoutId) {
          clearTimeout(notificationState.timeoutId);
        }
        this.pendingDriverNotifications.delete(moveId);
      }

      // Calculate a real-time ETA for the customer
      let estimatedArrival = "5-10 minutes";
      try {
        const driverDBLocation = driver.currentLocation.coordinates;
        const pickupLocation = move.pickup.coordinates.coordinates;

        if (driverDBLocation && pickupLocation) {
          route = await googleMapsService.calculateRoute(
            driverDBLocation,
            pickupLocation
          );

          if (route && route.duration) {
            estimatedArrival = route.duration;
          }
        } else {
          console.warn(`[MoveRequestService] Could not calculate ETA for move ${moveId} because driver location or pickup location was missing.`);
        }
      } catch (etaError) {
        console.error(`[MoveRequestService] CRITICAL: Error during ETA calculation for move ${moveId}:`, etaError);
      }

      // Notify the customer that their move was accepted
      trackingService.notifyCustomer(
        move.customer._id.toString(),
        "move:accepted",
        {
          message: "A driver has accepted your move request!",
          moveId: move._id.toString(),
          driver: {
            id: driver._id.toString(),
            user_id: driver.user._id.toString(),
            name: driver.user.name,
            phone: driver.user.phone,
            image: driver.user.image,
            vehicle: driver.vehicle,
            rating: driver.rating,
          },
          distance: route.distance,
          estimatedArrival: estimatedArrival,
          route: route.polyline,
        }
      );

      // Also, notify the driver for confirmation
      trackingService.notifyDriver(
        driver.user._id.toString(),
        "driver:move_accepted_confirmation",
        {
          message:
            "You have successfully accepted the move. Please go to the pickup location.",
          move: move.toObject(),
        }
      );

      return move.toObject();
    } catch (error) {
      console.error(
        `Error in acceptMoveRequest for move ${moveId} by driver ${driverUserId}:`,
        error
      );

      // Notify the driver of the failure
      if (driverUserId) {
        trackingService.notifyDriver(driverUserId, "move:acceptance_failed", {
          moveId,
          reason: error.message || "Unknown error accepting move",
        });
      }

      // Re-throw ApiError as is, wrap others
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to accept move: ${error.message}`, 500);
    } finally {
      try {
        await session.endSession();
      } catch (e) {
        console.error("Error ending session in acceptMoveRequest:", e);
      }
    }
  }

  async handleDriverRejection(moveId, driverUserId, reason = 'rejected') {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const notificationState = this.pendingDriverNotifications.get(moveId);
        if (!notificationState) {
          console.warn(`[MoveRequestService] No notification state for move ${moveId} during rejection. Assuming it was handled.`);
          return;
        }

        // CRITICAL: Ensure the rejection is from the currently notified driver's USER account
        if (notificationState.currentDriverUserId.toString() !== driverUserId.toString()) {
          console.warn(`[MoveRequestService] Rejection for move ${moveId} received from user ${driverUserId}, but expected ${notificationState.currentDriverUserId}. Ignoring.`);
          return;
        }

        if (notificationState.timeoutId) {
          clearTimeout(notificationState.timeoutId);
        }

        const move = await Move.findById(moveId).session(session);
        if (!move || move.status !== moveStatus.PENDING) {
          this.pendingDriverNotifications.delete(moveId); // Clean up state
          return;
        }

        if (notificationState.attempt >= MAX_DRIVER_SEARCH_ATTEMPTS) {
          move.status = moveStatus.NO_DRIVERS_AVAILABLE;
          await move.save({ session });
          this.pendingDriverNotifications.delete(moveId);
          trackingService.notifyCustomer(move.customer.toString(), 'move:no_drivers_found', {
            moveId: move._id.toString(),
            message: 'We could not find a driver for your move at this time. Please try again later.',
          });
          console.log(`[MoveRequestService] Max search attempts reached for move ${moveId}.`);
          return;
        }

        const excludedDriverIds = [...notificationState.excludedDriverIds];
        const pickupCoords = move.pickup.coordinates.coordinates;
        const allNearbyDrivers = (await googleMapsService.getNearbyDrivers(
            pickupCoords,
            move.vehicleType,
            5000
          )) || [];

        const nextDriverToNotify = allNearbyDrivers.find(
          (d) => !excludedDriverIds.includes(d.driverId)
        );

        if (nextDriverToNotify) {
          const newNotificationData = {
            ...notificationState,
            attempt: notificationState.attempt + 1,
            currentDriverId: nextDriverToNotify.driverId,
            currentDriverUserId: nextDriverToNotify.driverUserId, // Correctly set the new user ID
            excludedDriverIds: [
              ...excludedDriverIds,
              nextDriverToNotify.driverId,
            ],
            timeoutId: setTimeout(
              () => this.handleDriverResponseTimeout(moveId), // Simplified timeout call
              DRIVER_RESPONSE_TIMEOUT
            ),
          };
          this.pendingDriverNotifications.set(moveId, newNotificationData);

          trackingService.notifyDriver(
            nextDriverToNotify.driverUserId, // Notify the correct user
            'driver:new_move_request',
            { move: move.toObject() }
          );
          console.log(`[MoveRequestService] Rejection from user ${driverUserId} (attempt ${notificationState.attempt}), notifying next driver ${nextDriverToNotify.driverId} (user: ${nextDriverToNotify.driverUserId}) for move ${moveId}`);
        } else {
          move.status = moveStatus.NO_DRIVERS_AVAILABLE;
          await move.save({ session });
          this.pendingDriverNotifications.delete(moveId);
          trackingService.notifyCustomer(move.customer.toString(), 'move:no_drivers_found', {
            moveId: move._id.toString(),
            message: 'No available drivers were found for your move request.',
          });
          console.log(`[MoveRequestService] No more unique drivers to notify for move ${moveId}.`);
        }
      });
    } catch (error) {
      console.error(`Critical error in handleDriverRejection for move ${moveId}:`, error);
      this.pendingDriverNotifications.delete(moveId); // Cleanup on error
    } finally {
      await session.endSession();
    }
  }

  async updateMoveProgress(moveId, driverUserId, newStatus) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const move = await Move.findById(moveId)
        .populate("customer", "_id name email phone image")
        .populate({
          path: "driver",
          populate: { path: "user", select: "_id name email phone image" },
        })
        .session(session);

      if (!move) throw new ApiError("Move not found.", 404);

      if (!move.driver || move.driver.user._id.toString() !== driverUserId.toString()) {
        throw new ApiError("Driver not authorized for this move.", 403);
      }

      if (move.status === moveStatus.DELIVERED) {
        throw new ApiError("Cannot update move status as it is already delivered.", 400);
      }

      if (!this._isValidStatusTransition(move.status, newStatus)) {
        throw new ApiError(`Invalid status transition from ${move.status} to ${newStatus}.`, 400);
      }

      move.status = newStatus;
      await move.save({ session });

      if (newStatus === moveStatus.DELIVERED) {
        // --- Payment Logic ---
        if (move.payment && move.payment.method === 'CASH') {
          move.payment.status = 'completed';
          await move.save({ session });
          trackingService.notifyCustomer(move.customer._id.toString(), "move:payment_completed", {
            moveId: move._id.toString(),
            message: "تم الدفع نقداً بنجاح. شكراً لاستخدامك Swift Move!",
          });
        } else if (move.payment && move.payment.method === 'VISA') {
          const Stripe = require('stripe');
          const stripe = new Stripe(process.env.STRIPE_KEY);
          const sessionStripe = await stripe.checkout.sessions.create({
            mode: "payment",
            payment_method_types: ["card"],
            success_url: process.env.SUCCESS_URL,
            cancel_url: process.env.CANCEL_URL,
            customer_email: move.customer.email,
            client_reference_id: move._id.toString(),
            line_items: [{
              price_data: {
                currency: "EGP",
                product_data: {
                  name: "Move Payment",
                },
                unit_amount: move.pricing.totalPrice * 100,
              },
              quantity: 1,
            }],
            metadata: {
              moveId: move._id.toString(),
            },
          });
          trackingService.notifyCustomer(move.customer._id.toString(), "move:payment_required", {
            url: sessionStripe.url,
            moveId: move._id.toString(),
            message: "يرجى إتمام عملية الدفع لإكمال الطلب.",
          });
        }
        await this._finalizeMoveCompletion(move, session);
      }

      await session.commitTransaction();

      // --- Notify Customer of Progress ---
      const customerId = move.customer._id.toString();
      let notificationMessage = "";

      switch (newStatus) {
        case moveStatus.ARRIVED_AT_PICKUP:
          notificationMessage = "Your driver has arrived at the pickup location.";
          break;
        case moveStatus.PICKED_UP:
          notificationMessage = "Your items have been picked up and the move is now in transit.";
          break;
        case moveStatus.ARRIVED_AT_DELIVERY:
          notificationMessage = "Your driver has arrived at the delivery location.";
          break;
        case moveStatus.DELIVERED:
          notificationMessage = "Your move has been successfully completed!";
          break;
      }

      if (notificationMessage) {
        trackingService.notifyCustomer(customerId, "move:status_update", {
          moveId: move._id.toString(),
          status: newStatus,
          message: notificationMessage,
        });
      }

      return move.toObject();
    } catch (error) {
      await session.abortTransaction();
      if (error instanceof ApiError) throw error;
      console.error(`Error updating move ${moveId} progress:`, error);
      throw new ApiError(
        `Failed to update move progress: ${error.message}`,
        500
      );
    } finally {
      session.endSession();
    }
  }

  _isValidStatusTransition(currentStatus, newStatus) {
    const flow = {
      [moveStatus.PENDING]: [
        moveStatus.ACCEPTED,
        moveStatus.NO_DRIVERS_AVAILABLE,
        moveStatus.CANCELLED_BY_CUSTOMER,
        moveStatus.CANCELLED_BY_ADMIN,
      ],
      [moveStatus.ACCEPTED]: [
        moveStatus.ARRIVED_AT_PICKUP,
        moveStatus.CANCELLED_BY_CUSTOMER,
        moveStatus.CANCELLED_BY_DRIVER,
        moveStatus.CANCELLED_BY_ADMIN,
      ],
      [moveStatus.ARRIVED_AT_PICKUP]: [
        moveStatus.PICKED_UP,
        moveStatus.CANCELLED_BY_CUSTOMER,
        moveStatus.CANCELLED_BY_DRIVER,
        moveStatus.CANCELLED_BY_ADMIN,
      ],
      [moveStatus.PICKED_UP]: [
        moveStatus.ARRIVED_AT_DELIVERY,
        moveStatus.CANCELLED_BY_CUSTOMER,
        moveStatus.CANCELLED_BY_DRIVER,
        moveStatus.CANCELLED_BY_ADMIN,
      ],
      [moveStatus.ARRIVED_AT_DELIVERY]: [
        moveStatus.DELIVERED,
        moveStatus.CANCELLED_BY_ADMIN,
      ],
    };

    const terminalStates = [
      moveStatus.DELIVERED,
      moveStatus.CANCELLED_BY_ADMIN,
      moveStatus.CANCELLED_BY_CUSTOMER,
      moveStatus.CANCELLED_BY_DRIVER,
      moveStatus.NO_DRIVERS_AVAILABLE,
    ];

    if (terminalStates.includes(currentStatus)) {
      return false; // Cannot transition from a terminal state
    }

    return (
      (flow[currentStatus] && flow[currentStatus].includes(newStatus)) || false
    );
  }

  async getMoveDetails(moveId, userId, userRole) {
    if (!moveId) {
      throw new ApiError("Move ID is required.", 400);
    }

    // 1. Fetch the move and populate customer/driver user details
    const move = await Move.findById(moveId)
      .populate("customer", "name email phone image role")
      .populate({
        path: "driver",
        populate: { path: "user", select: "name email phone image role" },
      })
      .lean();

    if (!move) {
      throw new ApiError("Move not found.", 404);
    }

    // 2. Authorization check
    const isCustomer =
      move.customer && move.customer._id.toString() === userId.toString();
    const isDriver =
      move.driver && move.driver.user._id.toString() === userId.toString();
    const isAdmin = userRole === roles.ADMIN;

    if (!isCustomer && !isDriver && !isAdmin) {
      throw new ApiError("Not authorized to view this move.", 403);
    }

    // 3. If a driver is assigned, fetch their specific driver details (like vehicle)
    if (move.driver) {
      const driverDetails = await Driver.findOne({ user: move.driver._id })
        .select("vehicle rating.average") // Select specific fields from the Driver model
        .lean();

      // 4. Combine the driver-specific details into the move object
      if (driverDetails) {
        // To avoid overwriting the whole driver object, we attach details to it
        move.driver.vehicle = driverDetails.vehicle;
        move.driver.averageRating = driverDetails.rating.average;
      }
    }

    return move;
  }

  async getMovesForDriver(driverUserId, options = {}) {
    if (!driverUserId) {
      throw new ApiError("Driver user ID is required.", 400);
    }

    const page = options.page * 1 || 1;
    const limit = options.limit * 1 || 10;
    const skip = (page - 1) * limit;

    try {
      const driver = await Driver.findOne({ user: driverUserId })
        .select("_id")
        .lean();

      if (!driver) {
        throw new ApiError("No driver profile found.", 404);
      }

      const filter = { driver: driver._id };

      const totalMoves = await Move.countDocuments(filter);
      const totalPages = Math.ceil(totalMoves / limit);

      const moves = await Move.find(filter)
        .populate("customer", "name email phone image")
        .populate({
          path: "driver",
          populate: {
            path: "user",
            select: "name email phone image",
          },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      return { moves, totalPages, currentPage: page, totalMoves };
    } catch (error) {
      console.error(`Error fetching moves for driver ${driverUserId}:`, error);
      throw new ApiError("Failed to retrieve driver moves.", 500);
    }
  }

  async getMovesForCustomer(customerId, options = {}) {
    if (!customerId) {
      throw new ApiError("Customer ID is required.", 400);
    }

    const page = options.page * 1 || 1;
    const limit = options.limit * 1 || 10;
    const skip = (page - 1) * limit;

    try {
      const filter = { customer: customerId };

      const totalMoves = await Move.countDocuments(filter);
      const totalPages = Math.ceil(totalMoves / limit);

      const moves = await Move.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      return { moves, totalPages, currentPage: page, totalMoves };
    } catch (error) {
      console.error(`Error fetching moves for customer ${customerId}:`, error);
      throw new ApiError("Failed to retrieve customer moves.", 500);
    }
  }

  async _finalizeMoveCompletion(move, session) {
    console.log(`[MoveRequestService] Finalizing move ${move._id}`);

    if (!move.driver) return;

    // 1. Update the driver's status to make them available again at the drop-off location.
    await Driver.findByIdAndUpdate(
      move.driver._id,
      {
        isAvailable: true,
        currentLocation: move.delivery.coordinates,
      },
      { session }
    );
    console.log(`[MoveRequestService] Driver ${move.driver._id} is now available.`);

    // 2. Notify the driver that the move is complete.
    trackingService.notifyDriver(
      move.driver.user._id.toString(),
      "move:completed",
      {
        moveId: move._id.toString(),
        message: "You have successfully completed the move!",
      }
    );
  }

  async cancelMoveRequest(
    moveId,
    userId,
    userRole,
    reason = "No reason provided"
  ) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const move = await Move.findById(moveId)
        .populate({
          path: "driver",
          populate: { path: "user", select: "name email phone image role" },
        })
        .populate("customer", "name email phone image role")
        .session(session);
      if (!move) throw new ApiError("Move not found.", 404);

      let canCancel = false;
      let newStatus;

      if (
        userRole === roles.CUSTOMER &&
        move.customer._id.toString() === userId.toString()
      ) {
        if ([moveStatus.PENDING, moveStatus.ACCEPTED].includes(move.status)) {
          canCancel = true;
          newStatus = moveStatus.CANCELLED_BY_CUSTOMER;
        }
      } else if (
        userRole === roles.DRIVER &&
        move.driver &&
        move.driver.user._id.toString() === userId.toString()
      ) {
        if (
          [moveStatus.ACCEPTED, moveStatus.ARRIVED_AT_PICKUP].includes(
            move.status
          )
        ) {
          canCancel = true;
          newStatus = moveStatus.CANCELLED_BY_DRIVER;
        }
      } else if (userRole === roles.ADMIN) {
        canCancel = true;
        newStatus = moveStatus.CANCELLED_BY_ADMIN;
      }

      if (!canCancel)
        throw new ApiError(
          `User ${userId} (${userRole}) cannot cancel move ${moveId} in state ${move.status}.`,
          403
        );

      move.status = newStatus;
      move.cancellationReason = reason;
      if (!move.actualTime) move.actualTime = {};
      move.actualTime.cancelledAt = new Date();

      if (
        move.driver &&
        (newStatus === moveStatus.CANCELLED_BY_CUSTOMER ||
          newStatus === moveStatus.CANCELLED_BY_ADMIN)
      ) {
        const driverDoc = await Driver.findById(move.driver._id).session(
          session
        );
        if (driverDoc) {
          driverDoc.isAvailable = true;
          await driverDoc.save({ session });
        }
      } else if (move.driver && move.status === moveStatus.CANCELLED_BY_DRIVER) {
        const driverDoc = await Driver.findById(move.driver._id).session(
          session
        );
        if (driverDoc) {
          driverDoc.isAvailable = true;
          await driverDoc.save({ session });
        }
      }

      await move.save({ session });

      // --- Notify Relevant Parties ---
      const customerId = move.customer._id.toString();
      const driverUserId = move.driver && move.driver.user ? move.driver.user._id.toString() : null;

      if (newStatus === moveStatus.CANCELLED_BY_CUSTOMER && driverUserId) {
        if (driverUserId) {
          trackingService.notifyDriver(driverUserId, 'move:cancelled', {
            moveId,
            message: `The move has been cancelled by the customer. Reason: ${reason}`,
          });
        }
      } else if (newStatus === moveStatus.CANCELLED_BY_DRIVER) {
        trackingService.notifyCustomer(customerId, 'move:cancelled', {
          moveId,
          message: `Your move has been cancelled by the driver. Reason: ${reason}`,
        });
        if (driverUserId) {
          trackingService.notifyDriver(driverUserId, 'move:cancelled', {
            moveId,
            message: 'You have successfully cancelled the move.',
          });
        }
      } else if (newStatus === moveStatus.CANCELLED_BY_ADMIN) {
        trackingService.notifyCustomer(customerId, 'move:cancelled', {
          moveId,
          message: `Your move has been cancelled by administration. Reason: ${reason}`,
        });
        if (driverUserId) {
          trackingService.notifyDriver(driverUserId, 'move:cancelled', {
            moveId,
            message: `The move has been cancelled by administration. Reason: ${reason}`,
          });
        }
      }

      await session.commitTransaction();

      return move.toObject();
    } catch (error) {
      await session.abortTransaction();
      if (error instanceof ApiError) throw error;
      console.error(`Error cancelling move ${moveId}:`, error);
      throw new ApiError(`Failed to cancel move: ${error.message}`, 500);
    } finally {
      session.endSession();
    }
  }

  async getAllMoves(queryParams) {
    const { page, limit, ...query } = queryParams;

    let filter = {};

    // // Build a robust filter object from query parameters
    // for (const key in query) {
    //   if (Object.prototype.hasOwnProperty.call(query, key)) {
    //     const value = query[key];

    //     // Validate ObjectIds to prevent crashes from invalid formats
    //     if ((key === 'customer' || key === 'driver') && !mongoose.Types.ObjectId.isValid(value)) {
    //         // If an invalid ID is provided, no results can match. Return empty.
    //         return { totalPages: 0, page: 1, results: 0, data: [] };
    //     }

    //     // Apply filter based on key
    //     if (['customer', 'driver', 'status', 'vehicleType'].includes(key)) {
    //         filter[key] = value; // Exact match for IDs and enums
    //     } else {
    //         // Fallback for other potential string fields
    //         filter[key] = { $regex: value, $options: 'i' };
    //     }
    //   }
    // }

    Object.keys(query).forEach((key) => {
      if (typeof query[key] === "string") {
        filter[key] = { $regex: query[key], $options: "i" };
      } else {
        filter[key] = query[key];
      }
    });

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const skipNum = (pageNum - 1) * limitNum;

    // Get total count for pagination using the constructed filter
    const totalMovesCount = await Move.countDocuments(filter);
    const totalPages = Math.ceil(totalMovesCount / limitNum);

    // Fetch moves with filter, population, sorting, and pagination
    const moves = await Move.find(filter)
      .populate({ path: 'customer', select: 'name email phone' })
      .populate({ path: 'driver', select: 'name email phone' })
      .sort({ createdAt: -1 })
      .skip(skipNum)
      .limit(limitNum)
      .lean();

    return {
      totalPages,
      page: pageNum,
      results: moves.length,
      data: moves,
    };
  }
}

module.exports = new MoveRequestService();
