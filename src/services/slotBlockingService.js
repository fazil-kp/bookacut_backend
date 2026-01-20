const { getModel } = require('../database/modelFactory');
const slotSchema = require('../client/models/Slot').schema;
const bookingSchema = require('../client/models/Booking').schema;
const moment = require('moment');

/**
 * Slot Blocking Service
 * Handles slot blocking/unblocking with booking cancellation
 * Works with database-per-client architecture
 */
class SlotBlockingService {
  /**
   * Block a slot and cancel all active bookings
   * @param {string} databaseName - Client database name
   * @param {string} shopId - Shop ID
   * @param {string} date - Slot date (ISO string or Date)
   * @param {string} slotTime - Slot start time (HH:mm format)
   * @param {string} adminUserId - Client admin user ID who is blocking
   * @param {string} reason - Optional reason for blocking
   * @returns {Promise<Object>} Updated slot and cancelled bookings
   */
  async blockSlot(databaseName, shopId, date, slotTime, adminUserId, reason = null) {
    try {
      // Get models for this database
      const Slot = await getModel(databaseName, 'Slot', slotSchema);
      const Booking = await getModel(databaseName, 'Booking', bookingSchema);

      // Normalize date to start of day
      const slotDate = moment(date).startOf('day').toDate();

      // Find the slot
      const slot = await Slot.findOne({
        shopId,
        date: slotDate,
        startTime: slotTime,
      });

      if (!slot) {
        throw new Error('Slot not found');
      }

      // Check if already blocked
      if (slot.isBlocked) {
        throw new Error('Slot is already blocked');
      }

      // Find all active bookings in this slot
      const activeBookings = await Booking.find({
        slotId: slot._id,
        status: { $in: ['pending', 'confirmed', 'arrived', 'in_progress'] },
      });

      // Cancel all active bookings in a transaction-like manner
      const cancelledBookings = [];
      for (const booking of activeBookings) {
        booking.status = 'cancelled';
        booking.cancelledAt = new Date();
        booking.cancelledBy = adminUserId;
        booking.cancelledByType = 'admin';
        booking.cancellationReason = reason || 'Slot blocked by admin';

        await booking.save();
        cancelledBookings.push(booking);
      }

      // Mark slot as blocked
      slot.isBlocked = true;
      slot.status = 'blocked';
      slot.blockedBy = adminUserId;
      slot.blockedAt = new Date();
      slot.blockedReason = reason;

      // Reset booked count since all bookings are cancelled
      slot.bookedCount = 0;

      await slot.save();

      // Emit Socket.IO event for slot updates
      if (global.slotSocket) {
        try {
          await global.slotSocket.notifySlotCapacityChange(databaseName, shopId);
        } catch (error) {
          console.error('Error emitting slot update event:', error.message);
        }
      }

      // Log the blocking action
      console.log(`Slot blocked: ${databaseName} - Shop ${shopId} - ${date} ${slotTime}`);
      console.log(`Cancelled ${cancelledBookings.length} bookings`);
      if (reason) {
        console.log(`Block reason: ${reason}`);
      }

      return {
        slot,
        cancelledBookings: cancelledBookings.map((b) => ({
          id: b._id,
          customerId: b.customerId,
          status: b.status,
          cancelledAt: b.cancelledAt,
          cancellationReason: b.cancellationReason,
        })),
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Unblock a slot
   * @param {string} databaseName - Client database name
   * @param {string} shopId - Shop ID
   * @param {string} date - Slot date (ISO string or Date)
   * @param {string} slotTime - Slot start time (HH:mm format)
   * @returns {Promise<Object>} Updated slot
   */
  async unblockSlot(databaseName, shopId, date, slotTime) {
    try {
      // Get Slot model for this database
      const Slot = await getModel(databaseName, 'Slot', slotSchema);

      // Normalize date to start of day
      const slotDate = moment(date).startOf('day').toDate();

      // Find the slot
      const slot = await Slot.findOne({
        shopId,
        date: slotDate,
        startTime: slotTime,
      });

      if (!slot) {
        throw new Error('Slot not found');
      }

      if (!slot.isBlocked) {
        throw new Error('Slot is not blocked');
      }

      // Unblock the slot
      slot.isBlocked = false;
      slot.blockedBy = null;
      slot.blockedAt = null;
      slot.unblockAt = new Date();
      slot.blockedReason = null;

      // Determine status based on capacity
      if (slot.bookedCount >= slot.capacity) {
        slot.status = 'full';
      } else {
        slot.status = 'available';
      }

      await slot.save();

      // Emit Socket.IO event for slot updates
      if (global.slotSocket) {
        try {
          await global.slotSocket.notifySlotCapacityChange(databaseName, shopId);
        } catch (error) {
          console.error('Error emitting slot update event:', error.message);
        }
      }

      // Log the unblocking action
      console.log(`Slot unblocked: ${databaseName} - Shop ${shopId} - ${date} ${slotTime}`);

      return slot;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Block a slot by slotId (alternative method)
   * @param {string} databaseName - Client database name
   * @param {string} shopId - Shop ID
   * @param {string} slotId - Slot ID
   * @param {string} adminUserId - Client admin user ID
   * @param {string} reason - Optional reason
   * @returns {Promise<Object>} Updated slot and cancelled bookings
   */
  async blockSlotById(databaseName, shopId, slotId, adminUserId, reason = null) {
    try {
      const Slot = await getModel(databaseName, 'Slot', slotSchema);
      const Booking = await getModel(databaseName, 'Booking', bookingSchema);

      // Find the slot
      const slot = await Slot.findOne({
        _id: slotId,
        shopId,
      });

      if (!slot) {
        throw new Error('Slot not found');
      }

      if (slot.isBlocked) {
        throw new Error('Slot is already blocked');
      }

      // Find and cancel all active bookings
      const activeBookings = await Booking.find({
        slotId: slot._id,
        status: { $in: ['pending', 'confirmed', 'arrived', 'in_progress'] },
      });

      const cancelledBookings = [];
      for (const booking of activeBookings) {
        booking.status = 'cancelled';
        booking.cancelledAt = new Date();
        booking.cancelledBy = adminUserId;
        booking.cancelledByType = 'admin';
        booking.cancellationReason = reason || 'Slot blocked by admin';

        await booking.save();
        cancelledBookings.push(booking);
      }

      // Mark slot as blocked
      slot.isBlocked = true;
      slot.status = 'blocked';
      slot.blockedBy = adminUserId;
      slot.blockedAt = new Date();
      slot.blockedReason = reason;
      slot.bookedCount = 0;

      await slot.save();

      // Emit Socket.IO event for slot updates
      if (global.slotSocket) {
        try {
          await global.slotSocket.notifySlotCapacityChange(databaseName, shopId);
        } catch (error) {
          console.error('Error emitting slot update event:', error.message);
        }
      }

      return {
        slot,
        cancelledBookings: cancelledBookings.map((b) => ({
          id: b._id,
          customerId: b.customerId,
          status: b.status,
          cancelledAt: b.cancelledAt,
          cancellationReason: b.cancellationReason,
        })),
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Unblock a slot by slotId (alternative method)
   * @param {string} databaseName - Client database name
   * @param {string} shopId - Shop ID
   * @param {string} slotId - Slot ID
   * @returns {Promise<Object>} Updated slot
   */
  async unblockSlotById(databaseName, shopId, slotId) {
    try {
      const Slot = await getModel(databaseName, 'Slot', slotSchema);

      const slot = await Slot.findOne({
        _id: slotId,
        shopId,
      });

      if (!slot) {
        throw new Error('Slot not found');
      }

      if (!slot.isBlocked) {
        throw new Error('Slot is not blocked');
      }

      slot.isBlocked = false;
      slot.blockedBy = null;
      slot.blockedAt = null;
      slot.unblockAt = new Date();
      slot.blockedReason = null;

      if (slot.bookedCount >= slot.capacity) {
        slot.status = 'full';
      } else {
        slot.status = 'available';
      }

      await slot.save();

      // Emit Socket.IO event for slot updates
      if (global.slotSocket) {
        try {
          await global.slotSocket.notifySlotCapacityChange(databaseName, shopId);
        } catch (error) {
          console.error('Error emitting slot update event:', error.message);
        }
      }

      return slot;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new SlotBlockingService();

