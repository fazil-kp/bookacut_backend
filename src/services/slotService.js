const Slot = require('../models/Slot');
const Shop = require('../models/Shop');
const StaffProfile = require('../models/StaffProfile');
const moment = require('moment');
const { DEFAULT_SLOT_DURATION } = require('../config/constants');

/**
 * Slot Service
 * Handles dynamic slot generation and management
 */
class SlotService {
  /**
   * Generate slots for a shop for a specific date
   * Slot capacity = number of active staff
   */
  async generateSlotsForDate(tenantId, shopId, date) {
    try {
      // Get shop details
      const shop = await Shop.findOne({ _id: shopId, tenantId });

      if (!shop) {
        throw new Error('Shop not found');
      }

      // Get active staff count for this shop
      const activeStaffCount = await StaffProfile.countDocuments({
        tenantId,
        shopId,
        isActive: true,
      });

      if (activeStaffCount === 0) {
        throw new Error('No active staff found for this shop');
      }

      // Get day of week
      const dayOfWeek = moment(date).format('dddd').toLowerCase();
      const workingHours = shop.workingHours[dayOfWeek];

      if (!workingHours || !workingHours.isOpen) {
        return []; // Shop is closed on this day
      }

      const slots = [];
      const slotDuration = shop.slotDuration || DEFAULT_SLOT_DURATION;
      const startTime = moment(workingHours.start, 'HH:mm');
      const endTime = moment(workingHours.end, 'HH:mm');

      // Generate slots for the day
      let currentTime = moment(date).set({
        hour: startTime.hour(),
        minute: startTime.minute(),
        second: 0,
        millisecond: 0,
      });

      while (currentTime.isBefore(moment(date).set({
        hour: endTime.hour(),
        minute: endTime.minute(),
      }))) {
        const slotEndTime = moment(currentTime).add(slotDuration, 'minutes');

        // Check if slot already exists
        const existingSlot = await Slot.findOne({
          tenantId,
          shopId,
          date: moment(date).startOf('day').toDate(),
          startTime: currentTime.format('HH:mm'),
        });

        if (!existingSlot) {
          const slot = await Slot.create({
            tenantId,
            shopId,
            date: moment(date).startOf('day').toDate(),
            startTime: currentTime.format('HH:mm'),
            endTime: slotEndTime.format('HH:mm'),
            capacity: activeStaffCount,
            maxCapacity: activeStaffCount,
            status: 'available',
          });

          slots.push(slot);
        }

        currentTime.add(slotDuration, 'minutes');
      }

      return slots;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Generate slots for multiple days (up to booking advance days)
   */
  async generateSlotsForDateRange(tenantId, shopId, startDate, endDate) {
    const slots = [];
    const currentDate = moment(startDate);
    const end = moment(endDate);

    while (currentDate.isSameOrBefore(end, 'day')) {
      const daySlots = await this.generateSlotsForDate(
        tenantId,
        shopId,
        currentDate.toDate()
      );
      slots.push(...daySlots);
      currentDate.add(1, 'day');
    }

    return slots;
  }

  /**
   * Update slot capacity based on current staff count
   */
  async updateSlotCapacity(tenantId, shopId, date) {
    try {
      const activeStaffCount = await StaffProfile.countDocuments({
        tenantId,
        shopId,
        isActive: true,
      });

      const slots = await Slot.find({
        tenantId,
        shopId,
        date: moment(date).startOf('day').toDate(),
        status: { $ne: 'blocked' },
      });

      for (const slot of slots) {
        // Update capacity but don't reduce below current bookings
        const newCapacity = Math.max(activeStaffCount, slot.bookedCount);
        slot.capacity = newCapacity;
        slot.maxCapacity = activeStaffCount;

        if (slot.bookedCount >= slot.capacity) {
          slot.status = 'full';
        } else if (slot.status === 'full' && slot.bookedCount < slot.capacity) {
          slot.status = 'available';
        }

        await slot.save();
      }

      return slots;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Block a slot
   */
  async blockSlot(tenantId, shopId, slotId, blockedBy, reason) {
    try {
      const slot = await Slot.findOne({
        _id: slotId,
        tenantId,
        shopId,
      });

      if (!slot) {
        throw new Error('Slot not found');
      }

      slot.status = 'blocked';
      slot.blockedBy = blockedBy;
      slot.blockedReason = reason;

      await slot.save();

      // Emit Socket.IO event
      if (global.slotSocket) {
        await global.slotSocket.notifySlotCapacityChange(tenantId, shopId);
      }

      return slot;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Unblock a slot
   */
  async unblockSlot(tenantId, shopId, slotId) {
    try {
      const slot = await Slot.findOne({
        _id: slotId,
        tenantId,
        shopId,
      });

      if (!slot) {
        throw new Error('Slot not found');
      }

      slot.status = slot.bookedCount >= slot.capacity ? 'full' : 'available';
      slot.blockedBy = null;
      slot.blockedReason = null;

      await slot.save();

      // Emit Socket.IO event
      if (global.slotSocket) {
        await global.slotSocket.notifySlotCapacityChange(tenantId, shopId);
      }

      return slot;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Reduce slot capacity manually
   */
  async reduceSlotCapacity(tenantId, shopId, slotId, newCapacity) {
    try {
      const slot = await Slot.findOne({
        _id: slotId,
        tenantId,
        shopId,
      });

      if (!slot) {
        throw new Error('Slot not found');
      }

      if (newCapacity < slot.bookedCount) {
        throw new Error('Cannot reduce capacity below current bookings');
      }

      slot.capacity = newCapacity;

      if (slot.bookedCount >= slot.capacity) {
        slot.status = 'full';
      } else {
        slot.status = 'available';
      }

      await slot.save();

      // Emit Socket.IO event
      if (global.slotSocket) {
        await global.slotSocket.notifySlotCapacityChange(tenantId, shopId);
      }

      return slot;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get available slots for a shop and date range
   */
  async getAvailableSlots(tenantId, shopId, startDate, endDate) {
    try {
      const slots = await Slot.find({
        tenantId,
        shopId,
        date: {
          $gte: moment(startDate).startOf('day').toDate(),
          $lte: moment(endDate).endOf('day').toDate(),
        },
        isBlocked: false, // Exclude blocked slots
        status: 'available',
      })
        .populate('shopId', 'name')
        .sort({ date: 1, startTime: 1 });

      // Filter slots that have capacity and are not blocked
      return slots.filter((slot) => !slot.isBlocked && slot.bookedCount < slot.capacity);
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new SlotService();

