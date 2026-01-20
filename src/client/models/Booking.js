const mongoose = require('mongoose');

/**
 * Booking Model Schema
 * Stored in CLIENT DATABASE
 * Represents customer bookings (online or walk-in)
 * NO tenantId - database isolation provides tenant separation
 */
const bookingSchema = new mongoose.Schema(
  {
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: [true, 'Shop ID is required'],
      index: true,
    },
    slotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Slot',
      required: [true, 'Slot ID is required'],
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Customer ID is required'],
      index: true,
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: [true, 'Service ID is required'],
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StaffProfile',
    },
    bookingType: {
      type: String,
      enum: ['online', 'walkin'],
      required: true,
      default: 'online',
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'arrived', 'in_progress', 'completed', 'no_show', 'rejected', 'cancelled'],
      default: 'confirmed',
      index: true,
    },
    originalPrice: {
      type: Number,
      required: true,
    },
    finalPrice: {
      type: Number,
      required: true,
    },
    priceEdited: {
      type: Boolean,
      default: false,
    },
    editedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    editReason: {
      type: String,
    },
    scheduledAt: {
      type: Date,
      required: true,
    },
    arrivedAt: {
      type: Date,
    },
    startedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    finishedAt: {
      type: Date,
    },
    cancelledAt: {
      type: Date,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    cancelledByType: {
      type: String,
      enum: ['admin', 'system', 'customer', 'staff'],
      // 'admin' - cancelled by client admin (slot blocking)
      // 'system' - auto-cancelled by system
      // 'customer' - cancelled by customer
      // 'staff' - cancelled by staff
    },
    cancellationReason: {
      type: String,
    },
    notes: {
      type: String,
    },
    priority: {
      type: String,
      enum: ['normal', 'high'],
      default: 'normal',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
bookingSchema.index({ shopId: 1, status: 1 });
bookingSchema.index({ shopId: 1, scheduledAt: 1 });
bookingSchema.index({ customerId: 1 });
bookingSchema.index({ slotId: 1, status: 1 });
bookingSchema.index({ shopId: 1, bookingType: 1 });

// Update slot booked count when booking status changes
// Note: This hook will be updated to work with dynamic models
bookingSchema.post('save', async function () {
  // Get Slot model dynamically
  // This will be handled by the model factory
  try {
    const Slot = this.constructor.db.model('Slot');
    if (Slot) {
      const slot = await Slot.findById(this.slotId);
      if (slot) {
        await slot.updateBookedCount();
      }
    }
  } catch (error) {
    // Silently fail - slot update is not critical
    console.error('Error updating slot booked count:', error.message);
  }
});

module.exports = {
  schema: bookingSchema,
};

