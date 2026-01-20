const mongoose = require('mongoose');

/**
 * Slot Model Schema
 * Stored in CLIENT DATABASE
 * Time slots for bookings, dynamically generated based on shop settings
 * NO tenantId - database isolation provides tenant separation
 */
const slotSchema = new mongoose.Schema(
  {
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: [true, 'Shop ID is required'],
      index: true,
    },
    date: {
      type: Date,
      required: [true, 'Slot date is required'],
      index: true,
    },
    startTime: {
      type: String,
      required: [true, 'Start time is required'],
    },
    endTime: {
      type: String,
      required: [true, 'End time is required'],
    },
    capacity: {
      type: Number,
      required: [true, 'Slot capacity is required'],
      default: 1,
      min: 0,
    },
    maxCapacity: {
      type: Number,
      required: true,
      min: 1,
    },
    bookedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ['available', 'blocked', 'full'],
      default: 'available',
      index: true,
    },
    isBlocked: {
      type: Boolean,
      default: false,
      index: true,
    },
    blockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    blockedAt: {
      type: Date,
    },
    unblockAt: {
      type: Date,
      // Optional: For scheduling automatic unblocking
    },
    blockedReason: {
      type: String,
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

// Compound indexes for efficient queries
slotSchema.index({ shopId: 1, date: 1 });
slotSchema.index({ shopId: 1, date: 1, status: 1 });
slotSchema.index({ shopId: 1, date: 1, startTime: 1 }, { unique: true });
slotSchema.index({ shopId: 1, date: 1, isBlocked: 1 }); // For filtering blocked slots
slotSchema.index({ isBlocked: 1, status: 1 }); // For availability queries

// Method to check if slot is available
slotSchema.methods.isAvailable = function () {
  return !this.isBlocked && this.status === 'available' && this.bookedCount < this.capacity;
};

// Method to update booked count
// Note: This will be updated to work with dynamic model loading
slotSchema.methods.updateBookedCount = async function () {
  // Get Booking model dynamically - this will be set by model factory
  const Booking = this.constructor.db.model('Booking');
  if (!Booking) {
    throw new Error('Booking model not found');
  }

  this.bookedCount = await Booking.countDocuments({
    slotId: this._id,
    status: { $in: ['confirmed', 'arrived', 'in_progress'] },
  });

  if (this.bookedCount >= this.capacity) {
    this.status = 'full';
  } else if (this.status === 'full' && this.bookedCount < this.capacity) {
    this.status = 'available';
  }

  await this.save();
};

module.exports = {
  schema: slotSchema,
};

