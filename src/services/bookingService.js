const Booking = require('../models/Booking');
const Slot = require('../models/Slot');
const Service = require('../models/Service');
const User = require('../models/User');
const ShopSettings = require('../models/ShopSettings');
const moment = require('moment');
const { BOOKING_STATUS, BOOKING_TYPE } = require('../config/constants');

/**
 * Booking Service
 * Handles all booking-related business logic
 */
class BookingService {
  /**
   * Create online booking
   */
  async createOnlineBooking(tenantId, shopId, slotId, serviceId, customerId) {
    try {
      // Validate slot exists and is available
      const slot = await Slot.findOne({
        _id: slotId,
        tenantId,
        shopId,
      });

      if (!slot) {
        throw new Error('Slot not found');
      }

      // Check if slot is blocked
      if (slot.isBlocked || slot.status === 'blocked') {
        throw new Error('Slot is blocked and cannot be booked');
      }

      // Check availability
      if (!slot.isAvailable()) {
        throw new Error('Slot is full');
      }

      // Validate service
      const service = await Service.findOne({
        _id: serviceId,
        tenantId,
        shopId,
        isActive: true,
      });

      if (!service) {
        throw new Error('Service not found or inactive');
      }

      // Get shop settings
      const settings = await ShopSettings.findOne({ tenantId, shopId });

      // Check booking advance days
      const bookingDate = moment(slot.date);
      const today = moment().startOf('day');
      const maxAdvanceDays = settings?.bookingAdvanceDays || 7;

      if (bookingDate.diff(today, 'days') > maxAdvanceDays) {
        throw new Error(`Bookings can only be made up to ${maxAdvanceDays} days in advance`);
      }

      // Create booking
      const booking = await Booking.create({
        tenantId,
        shopId,
        slotId,
        customerId,
        serviceId,
        bookingType: BOOKING_TYPE.ONLINE,
        status: settings?.autoConfirmBooking !== false ? BOOKING_STATUS.CONFIRMED : BOOKING_STATUS.PENDING,
        originalPrice: service.price,
        finalPrice: service.price,
        scheduledAt: moment(slot.date).set({
          hour: parseInt(slot.startTime.split(':')[0]),
          minute: parseInt(slot.startTime.split(':')[1]),
        }).toDate(),
      });

      // Update slot booked count
      await slot.updateBookedCount();

      return booking;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Create walk-in booking
   */
  async createWalkInBooking(tenantId, shopId, slotId, serviceId, customerData, staffId, price) {
    try {
      // Validate slot
      const slot = await Slot.findOne({
        _id: slotId,
        tenantId,
        shopId,
      });

      if (!slot) {
        throw new Error('Slot not found');
      }

      // Check if slot is blocked
      if (slot.isBlocked || slot.status === 'blocked') {
        throw new Error('Slot is blocked and cannot be booked');
      }

      // Create or get customer
      let customer = await User.findOne({
        tenantId,
        email: customerData.email,
        role: 'customer',
      });

      if (!customer) {
        customer = await User.create({
          tenantId,
          email: customerData.email,
          phone: customerData.phone,
          firstName: customerData.firstName,
          lastName: customerData.lastName,
          role: 'customer',
          bookingType: BOOKING_TYPE.WALKIN,
          isActive: true,
        });
      }

      // Get service for default price if not provided
      const service = await Service.findOne({
        _id: serviceId,
        tenantId,
        shopId,
      });

      const finalPrice = price || service.price;

      // Create booking with high priority
      const booking = await Booking.create({
        tenantId,
        shopId,
        slotId,
        customerId: customer._id,
        serviceId,
        staffId,
        bookingType: BOOKING_TYPE.WALKIN,
        status: BOOKING_STATUS.CONFIRMED,
        originalPrice: service.price,
        finalPrice: finalPrice,
        priceEdited: price !== service.price,
        editedBy: price !== service.price ? staffId : null,
        editReason: price !== service.price ? 'Walk-in pricing' : null,
        scheduledAt: moment(slot.date).set({
          hour: parseInt(slot.startTime.split(':')[0]),
          minute: parseInt(slot.startTime.split(':')[1]),
        }).toDate(),
        priority: 'high',
      });

      // Update slot booked count
      await slot.updateBookedCount();

      // Emit Socket.IO event
      if (global.slotSocket) {
        await global.slotSocket.notifyBookingChange(tenantId, shopId, booking);
      }

      return booking;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Mark customer as arrived
   */
  async markArrived(tenantId, shopId, bookingId) {
    try {
      const booking = await Booking.findOne({
        _id: bookingId,
        tenantId,
        shopId,
        status: BOOKING_STATUS.CONFIRMED,
      });

      if (!booking) {
        throw new Error('Booking not found or already processed');
      }

      booking.status = BOOKING_STATUS.ARRIVED;
      booking.arrivedAt = new Date();

      await booking.save();

      // Emit Socket.IO event
      if (global.slotSocket) {
        await global.slotSocket.notifyBookingChange(tenantId, shopId, booking);
      }

      return booking;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Mark booking as no-show
   */
  async markNoShow(tenantId, shopId, bookingId) {
    try {
      const booking = await Booking.findOne({
        _id: bookingId,
        tenantId,
        shopId,
        status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.ARRIVED] },
      });

      if (!booking) {
        throw new Error('Booking not found');
      }

      booking.status = BOOKING_STATUS.NO_SHOW;

      await booking.save();

      // Free up slot capacity
      const slot = await Slot.findById(booking.slotId);
      if (slot) {
        await slot.updateBookedCount();
      }

      // Emit Socket.IO event
      if (global.slotSocket) {
        await global.slotSocket.notifyBookingChange(tenantId, shopId, booking);
      }

      return booking;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Start service (mark in progress)
   */
  async startService(tenantId, shopId, bookingId, staffId) {
    try {
      const booking = await Booking.findOne({
        _id: bookingId,
        tenantId,
        shopId,
        status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.ARRIVED] },
      });

      if (!booking) {
        throw new Error('Booking not found or cannot be started');
      }

      booking.status = BOOKING_STATUS.IN_PROGRESS;
      booking.staffId = staffId;
      booking.startedAt = new Date();

      if (!booking.arrivedAt) {
        booking.arrivedAt = new Date();
      }

      await booking.save();

      // Emit Socket.IO event
      if (global.slotSocket) {
        await global.slotSocket.notifyBookingChange(tenantId, shopId, booking);
      }

      return booking;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Complete service
   */
  async completeService(tenantId, shopId, bookingId) {
    try {
      const booking = await Booking.findOne({
        _id: bookingId,
        tenantId,
        shopId,
        status: BOOKING_STATUS.IN_PROGRESS,
      });

      if (!booking) {
        throw new Error('Booking not found or not in progress');
      }

      booking.status = BOOKING_STATUS.COMPLETED;
      booking.completedAt = new Date();
      booking.finishedAt = new Date();

      await booking.save();

      // Emit Socket.IO event
      if (global.slotSocket) {
        await global.slotSocket.notifyBookingChange(tenantId, shopId, booking);
      }

      return booking;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Edit booking price
   */
  async editPrice(tenantId, shopId, bookingId, newPrice, editedBy, reason) {
    try {
      const booking = await Booking.findOne({
        _id: bookingId,
        tenantId,
        shopId,
        status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.ARRIVED, BOOKING_STATUS.IN_PROGRESS] },
      });

      if (!booking) {
        throw new Error('Booking not found or cannot be edited');
      }

      // Check if price editing is allowed
      const settings = await ShopSettings.findOne({ tenantId, shopId });

      if (settings && !settings.allowPriceEditing) {
        throw new Error('Price editing is disabled for this shop');
      }

      // Check max discount percentage
      if (settings && settings.maxDiscountPercentage) {
        const discountPercentage = ((booking.originalPrice - newPrice) / booking.originalPrice) * 100;
        if (discountPercentage > settings.maxDiscountPercentage) {
          throw new Error(`Discount cannot exceed ${settings.maxDiscountPercentage}%`);
        }
      }

      booking.finalPrice = newPrice;
      booking.priceEdited = true;
      booking.editedBy = editedBy;
      booking.editReason = reason;

      await booking.save();

      // Emit Socket.IO event
      if (global.slotSocket) {
        await global.slotSocket.notifyBookingChange(tenantId, shopId, booking);
      }

      return booking;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Cancel booking
   */
  async cancelBooking(tenantId, shopId, bookingId, cancelledBy, reason) {
    try {
      const booking = await Booking.findOne({
        _id: bookingId,
        tenantId,
        shopId,
        status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.ARRIVED] },
      });

      if (!booking) {
        throw new Error('Booking not found or cannot be cancelled');
      }

      booking.status = BOOKING_STATUS.CANCELLED;
      booking.cancelledAt = new Date();
      booking.cancelledBy = cancelledBy;
      booking.cancellationReason = reason;

      await booking.save();

      // Free up slot capacity
      const slot = await Slot.findById(booking.slotId);
      if (slot) {
        await slot.updateBookedCount();
      }

      // Emit Socket.IO event
      if (global.slotSocket) {
        await global.slotSocket.notifyBookingChange(tenantId, shopId, booking);
      }

      return booking;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get bookings for a shop
   */
  async getShopBookings(tenantId, shopId, filters = {}) {
    try {
      const query = {
        tenantId,
        shopId,
      };

      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.date) {
        const startOfDay = moment(filters.date).startOf('day').toDate();
        const endOfDay = moment(filters.date).endOf('day').toDate();
        query.scheduledAt = { $gte: startOfDay, $lte: endOfDay };
      }

      if (filters.staffId) {
        query.staffId = filters.staffId;
      }

      const bookings = await Booking.find(query)
        .populate('customerId', 'firstName lastName phone email')
        .populate('serviceId', 'name price')
        .populate('staffId', 'userId')
        .populate('slotId', 'startTime endTime')
        .sort({ scheduledAt: 1 });

      return bookings;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get customer booking history
   */
  async getCustomerBookings(tenantId, customerId) {
    try {
      const bookings = await Booking.find({
        tenantId,
        customerId,
      })
        .populate('shopId', 'name address phone')
        .populate('serviceId', 'name price')
        .populate('slotId', 'date startTime endTime')
        .sort({ scheduledAt: -1 });

      return bookings;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new BookingService();

