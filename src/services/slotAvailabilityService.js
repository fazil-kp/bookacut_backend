const { getModel } = require('../database/modelFactory');
const slotSchema = require('../client/models/Slot').schema;
const moment = require('moment');

/**
 * Slot Availability Service
 * Handles slot availability queries with blocked slot filtering
 * Works with database-per-client architecture
 */
class SlotAvailabilityService {
  /**
   * Get available slots for a shop and date range
   * Filters out blocked slots
   * @param {string} databaseName - Client database name
   * @param {string} shopId - Shop ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} Available slots
   */
  async getAvailableSlots(databaseName, shopId, startDate, endDate) {
    try {
      const Slot = await getModel(databaseName, 'Slot', slotSchema);

      const slots = await Slot.find({
        shopId,
        date: {
          $gte: moment(startDate).startOf('day').toDate(),
          $lte: moment(endDate).endOf('day').toDate(),
        },
        isBlocked: false, // Exclude blocked slots
        status: { $in: ['available', 'full'] }, // Can include 'full' for visibility
      })
        .populate('shopId', 'name')
        .sort({ date: 1, startTime: 1 });

      // Filter slots that have capacity and are not blocked
      return slots.filter((slot) => {
        return !slot.isBlocked && slot.status === 'available' && slot.bookedCount < slot.capacity;
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Check if a slot is available for booking
   * @param {string} databaseName - Client database name
   * @param {string} slotId - Slot ID
   * @returns {Promise<boolean>} True if available
   */
  async isSlotAvailable(databaseName, slotId) {
    try {
      const Slot = await getModel(databaseName, 'Slot', slotSchema);

      const slot = await Slot.findById(slotId);

      if (!slot) {
        return false;
      }

      // Slot must not be blocked and must have capacity
      return !slot.isBlocked && slot.status === 'available' && slot.bookedCount < slot.capacity;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get slot by ID and verify it's available
   * @param {string} databaseName - Client database name
   * @param {string} slotId - Slot ID
   * @returns {Promise<Object>} Slot object
   * @throws {Error} If slot is not found or blocked
   */
  async getAvailableSlotById(databaseName, slotId) {
    try {
      const Slot = await getModel(databaseName, 'Slot', slotSchema);

      const slot = await Slot.findById(slotId);

      if (!slot) {
        throw new Error('Slot not found');
      }

      if (slot.isBlocked) {
        throw new Error('Slot is blocked and cannot be booked');
      }

      if (slot.status !== 'available' || slot.bookedCount >= slot.capacity) {
        throw new Error('Slot is full');
      }

      return slot;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new SlotAvailabilityService();

