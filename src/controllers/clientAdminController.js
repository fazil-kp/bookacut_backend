const { getModel } = require('../database/modelFactory');
const shopSchema = require('../client/models/Shop').schema;
const userSchema = require('../client/models/User').schema;
const staffProfileSchema = require('../client/models/StaffProfile').schema;
const roleSchema = require('../client/models/Role').schema;
const serviceSchema = require('../client/models/Service').schema;
const shopSettingsSchema = require('../client/models/ShopSettings').schema;
const bookingSchema = require('../client/models/Booking').schema;
const invoiceSchema = require('../client/models/Invoice').schema;
const slotService = require('../services/slotService');
const slotBlockingService = require('../services/slotBlockingService');
const invoiceService = require('../services/invoiceService');
const { NotFoundError, ValidationError, ConflictError } = require('../utils/errors');
const { ROLES, PERMISSIONS } = require('../config/constants');

/**
 * Client Admin Controller
 * Handles shop management, staff management, and admin operations
 */
class ClientAdminController {
  /**
   * Create Shop
   */
  async createShop(req, res, next) {
    try {
      const { name, address, phone, email, workingHours, slotDuration } = req.body;
      const tenantId = req.tenantId;

      if (!name || !phone) {
        throw new ValidationError('Shop name and phone are required');
      }

      // Check shop limit
      const Tenant = require('../models/Tenant');
      const tenant = await Tenant.findById(tenantId);
      const shopCount = await Shop.countDocuments({ tenantId, isActive: true });

      if (shopCount >= tenant.maxShops) {
        throw new ValidationError(`Maximum shop limit (${tenant.maxShops}) reached`);
      }

      // Create shop with default working hours if not provided
      const defaultWorkingHours = {
        monday: { start: '09:00', end: '18:00', isOpen: true },
        tuesday: { start: '09:00', end: '18:00', isOpen: true },
        wednesday: { start: '09:00', end: '18:00', isOpen: true },
        thursday: { start: '09:00', end: '18:00', isOpen: true },
        friday: { start: '09:00', end: '18:00', isOpen: true },
        saturday: { start: '09:00', end: '18:00', isOpen: true },
        sunday: { start: '09:00', end: '18:00', isOpen: false },
      };

      const shop = await Shop.create({
        tenantId,
        name,
        address,
        phone,
        email,
        workingHours: workingHours || defaultWorkingHours,
        slotDuration: slotDuration || 30,
        isActive: true,
      });

      // Create default shop settings
      await ShopSettings.create({
        tenantId,
        shopId: shop._id,
      });

      res.status(201).json({
        success: true,
        shop,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update Shop
   */
  async updateShop(req, res, next) {
    try {
      const { shopId } = req.params;
      const updates = req.body;
      const tenantId = req.tenantId;

      const shop = await Shop.findOne({ _id: shopId, tenantId });

      if (!shop) {
        throw new NotFoundError('Shop');
      }

      Object.assign(shop, updates);
      await shop.save();

      res.json({
        success: true,
        shop,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get All Shops
   */
  async getShops(req, res, next) {
    try {
      const tenantId = req.tenantId;
      const shops = await Shop.find({ tenantId, isActive: true }).sort({ createdAt: -1 });

      res.json({
        success: true,
        shops,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Shop Details
   */
  async getShop(req, res, next) {
    try {
      const { shopId } = req.params;
      const tenantId = req.tenantId;

      const shop = await Shop.findOne({ _id: shopId, tenantId });

      if (!shop) {
        throw new NotFoundError('Shop');
      }

      res.json({
        success: true,
        shop,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add Staff to Shop
   */
  async addStaff(req, res, next) {
    try {
      const { shopId } = req.params;
      const { email, password, phone, firstName, lastName, specialization, hourlyRate, commissionRate } = req.body;
      const tenantId = req.tenantId;

      if (!email || !password || !phone || !firstName || !lastName) {
        throw new ValidationError('All required fields must be provided');
      }

      // Verify shop exists
      const shop = await Shop.findOne({ _id: shopId, tenantId });

      if (!shop) {
        throw new NotFoundError('Shop');
      }

      // Check if user already exists
      let user = await User.findOne({ email, tenantId });

      if (!user) {
        // Get or create staff role
        let role = await Role.findOne({
          tenantId,
          name: ROLES.STAFF,
        });

        if (!role) {
          role = await Role.create({
            tenantId,
            name: ROLES.STAFF,
            permissions: [
              PERMISSIONS.VIEW_BOOKINGS,
              PERMISSIONS.CREATE_WALKIN,
              PERMISSIONS.EDIT_PRICE,
              PERMISSIONS.MARK_ARRIVED,
              PERMISSIONS.MARK_NO_SHOW,
              PERMISSIONS.COMPLETE_SERVICE,
              PERMISSIONS.GENERATE_INVOICE,
            ],
            isSystemRole: true,
          });
        }

        // Create user
        user = await User.create({
          tenantId,
          email,
          password,
          phone,
          firstName,
          lastName,
          role: ROLES.STAFF,
          roleId: role._id,
          isActive: true,
        });
      } else if (user.role !== ROLES.STAFF) {
        throw new ConflictError('User exists but is not a staff member');
      }

      // Check if staff already assigned to this shop
      const existingStaff = await StaffProfile.findOne({
        userId: user._id,
        shopId,
        tenantId,
      });

      if (existingStaff) {
        if (existingStaff.isActive) {
          throw new ConflictError('Staff already assigned to this shop');
        } else {
          // Reactivate staff
          existingStaff.isActive = true;
          existingStaff.leftAt = null;
          if (specialization) existingStaff.specialization = specialization;
          if (hourlyRate !== undefined) existingStaff.hourlyRate = hourlyRate;
          if (commissionRate !== undefined) existingStaff.commissionRate = commissionRate;
          await existingStaff.save();

          // Update slot capacities
          await slotService.updateSlotCapacity(tenantId, shopId, new Date());

          return res.json({
            success: true,
            staff: existingStaff,
          });
        }
      }

      // Create staff profile
      const staffProfile = await StaffProfile.create({
        tenantId,
        shopId,
        userId: user._id,
        specialization: specialization || [],
        hourlyRate: hourlyRate || 0,
        commissionRate: commissionRate || 0,
        isActive: true,
      });

      // Update slot capacities
      await slotService.updateSlotCapacity(tenantId, shopId, new Date());

      res.status(201).json({
        success: true,
        staff: staffProfile,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Shop Staff
   */
  async getShopStaff(req, res, next) {
    try {
      const { shopId } = req.params;
      const tenantId = req.tenantId;

      const staff = await StaffProfile.find({ tenantId, shopId, isActive: true })
        .populate('userId', 'firstName lastName email phone')
        .sort({ createdAt: -1 });

      res.json({
        success: true,
        staff,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Remove Staff from Shop
   */
  async removeStaff(req, res, next) {
    try {
      const { shopId, staffId } = req.params;
      const tenantId = req.tenantId;

      const staff = await StaffProfile.findOne({
        _id: staffId,
        tenantId,
        shopId,
      });

      if (!staff) {
        throw new NotFoundError('Staff');
      }

      staff.isActive = false;
      staff.leftAt = new Date();
      await staff.save();

      // Update slot capacities
      await slotService.updateSlotCapacity(tenantId, shopId, new Date());

      res.json({
        success: true,
        message: 'Staff removed successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update Staff Password
   */
  async updateStaffPassword(req, res, next) {
    try {
      const { shopId, staffId } = req.params;
      const { password } = req.body;
      const tenantId = req.tenantId;

      if (!password || password.length < 6) {
        throw new ValidationError('Password is required and must be at least 6 characters');
      }

      // Verify staff exists and belongs to this shop
      const staff = await StaffProfile.findOne({
        _id: staffId,
        tenantId,
        shopId,
        isActive: true,
      });

      if (!staff) {
        throw new NotFoundError('Staff');
      }

      // Get user and update password
      const User = require('../models/User');
      const user = await User.findById(staff.userId);

      if (!user) {
        throw new NotFoundError('User');
      }

      // Update password (will be hashed by pre-save hook)
      user.password = password;
      await user.save();

      res.json({
        success: true,
        message: 'Staff password updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update Staff Credentials (Email, Password, etc.)
   */
  async updateStaffCredentials(req, res, next) {
    try {
      const { shopId, staffId } = req.params;
      const { email, password, phone, firstName, lastName } = req.body;
      const tenantId = req.tenantId;

      // Verify staff exists and belongs to this shop
      const staff = await StaffProfile.findOne({
        _id: staffId,
        tenantId,
        shopId,
        isActive: true,
      }).populate('userId');

      if (!staff) {
        throw new NotFoundError('Staff');
      }

      const User = require('../models/User');
      const user = await User.findById(staff.userId);

      if (!user) {
        throw new NotFoundError('User');
      }

      // Update user fields
      if (email && email !== user.email) {
        // Check if email already exists
        const existingUser = await User.findOne({
          email,
          tenantId,
          _id: { $ne: user._id },
        });

        if (existingUser) {
          throw new ValidationError('Email already exists');
        }

        user.email = email;
      }

      if (password) {
        if (password.length < 6) {
          throw new ValidationError('Password must be at least 6 characters');
        }
        user.password = password;
      }

      if (phone) user.phone = phone;
      if (firstName) user.firstName = firstName;
      if (lastName) user.lastName = lastName;

      await user.save();

      res.json({
        success: true,
        message: 'Staff credentials updated successfully',
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create Service
   */
  async createService(req, res, next) {
    try {
      const { shopId } = req.params;
      const { name, description, category, duration, price } = req.body;
      const tenantId = req.tenantId;

      if (!name || !duration || !price) {
        throw new ValidationError('Name, duration, and price are required');
      }

      const service = await Service.create({
        tenantId,
        shopId,
        name,
        description,
        category,
        duration,
        price,
        isActive: true,
      });

      res.status(201).json({
        success: true,
        service,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Shop Services
   */
  async getShopServices(req, res, next) {
    try {
      const { shopId } = req.params;
      const tenantId = req.tenantId;

      const services = await Service.find({ tenantId, shopId, isActive: true }).sort({ name: 1 });

      res.json({
        success: true,
        services,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update Shop Settings
   */
  async updateShopSettings(req, res, next) {
    try {
      const { shopId } = req.params;
      const updates = req.body;
      const tenantId = req.tenantId;

      let settings = await ShopSettings.findOne({ tenantId, shopId });

      if (!settings) {
        settings = await ShopSettings.create({
          tenantId,
          shopId,
          ...updates,
        });
      } else {
        Object.assign(settings, updates);
        await settings.save();
      }

      res.json({
        success: true,
        settings,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Block Slot by Date and Time
   */
  async blockSlot(req, res, next) {
    try {
      const { shopId } = req.params;
      const { date, slotTime, reason } = req.body;
      const databaseName = req.user.databaseName;

      if (!date || !slotTime) {
        throw new ValidationError('Date and slotTime are required');
      }

      // Only client admin can block slots
      if (req.user.role !== ROLES.CLIENT_ADMIN) {
        throw new ValidationError('Only client admin can block slots');
      }

      const result = await slotBlockingService.blockSlot(
        databaseName,
        shopId,
        date,
        slotTime,
        req.user._id,
        reason
      );

      res.json({
        success: true,
        message: 'Slot blocked successfully',
        slot: result.slot,
        cancelledBookings: result.cancelledBookings,
        cancelledCount: result.cancelledBookings.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Block Slot by Slot ID (Alternative endpoint)
   */
  async blockSlotById(req, res, next) {
    try {
      const { shopId, slotId } = req.params;
      const { reason } = req.body;
      const databaseName = req.user.databaseName;

      // Only client admin can block slots
      if (req.user.role !== ROLES.CLIENT_ADMIN) {
        throw new ValidationError('Only client admin can block slots');
      }

      const result = await slotBlockingService.blockSlotById(
        databaseName,
        shopId,
        slotId,
        req.user._id,
        reason
      );

      res.json({
        success: true,
        message: 'Slot blocked successfully',
        slot: result.slot,
        cancelledBookings: result.cancelledBookings,
        cancelledCount: result.cancelledBookings.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Unblock Slot by Date and Time
   */
  async unblockSlot(req, res, next) {
    try {
      const { shopId } = req.params;
      const { date, slotTime } = req.body;
      const databaseName = req.user.databaseName;

      if (!date || !slotTime) {
        throw new ValidationError('Date and slotTime are required');
      }

      // Only client admin can unblock slots
      if (req.user.role !== ROLES.CLIENT_ADMIN) {
        throw new ValidationError('Only client admin can unblock slots');
      }

      const slot = await slotBlockingService.unblockSlot(
        databaseName,
        shopId,
        date,
        slotTime
      );

      res.json({
        success: true,
        message: 'Slot unblocked successfully',
        slot,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Unblock Slot by Slot ID (Alternative endpoint)
   */
  async unblockSlotById(req, res, next) {
    try {
      const { shopId, slotId } = req.params;
      const databaseName = req.user.databaseName;

      // Only client admin can unblock slots
      if (req.user.role !== ROLES.CLIENT_ADMIN) {
        throw new ValidationError('Only client admin can unblock slots');
      }

      const slot = await slotBlockingService.unblockSlotById(
        databaseName,
        shopId,
        slotId
      );

      res.json({
        success: true,
        message: 'Slot unblocked successfully',
        slot,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reduce Slot Capacity
   */
  async reduceSlotCapacity(req, res, next) {
    try {
      const { shopId, slotId } = req.params;
      const { capacity } = req.body;
      const tenantId = req.tenantId;

      if (!capacity || capacity < 1) {
        throw new ValidationError('Valid capacity is required');
      }

      const slot = await slotService.reduceSlotCapacity(tenantId, shopId, slotId, capacity);

      res.json({
        success: true,
        slot,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Generate Slots
   */
  async generateSlots(req, res, next) {
    try {
      const { shopId } = req.params;
      const { startDate, endDate } = req.body;
      const tenantId = req.tenantId;

      if (!startDate || !endDate) {
        throw new ValidationError('Start date and end date are required');
      }

      const slots = await slotService.generateSlotsForDateRange(
        tenantId,
        shopId,
        new Date(startDate),
        new Date(endDate)
      );

      res.json({
        success: true,
        slots,
        count: slots.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Shop Dashboard Stats
   */
  async getDashboardStats(req, res, next) {
    try {
      const { shopId } = req.params;
      const tenantId = req.tenantId;

      const today = new Date();
      const startOfDay = new Date(today.setHours(0, 0, 0, 0));
      const endOfDay = new Date(today.setHours(23, 59, 59, 999));

      // Today's bookings
      const todayBookings = await Booking.countDocuments({
        tenantId,
        shopId,
        scheduledAt: { $gte: startOfDay, $lte: endOfDay },
      });

      // Pending bookings
      const pendingBookings = await Booking.countDocuments({
        tenantId,
        shopId,
        status: 'confirmed',
      });

      // Active staff count
      const activeStaffCount = await StaffProfile.countDocuments({
        tenantId,
        shopId,
        isActive: true,
      });

      // Revenue stats
      const revenueStats = await invoiceService.getRevenueStats(
        tenantId,
        shopId,
        new Date(today.getFullYear(), today.getMonth(), 1),
        endOfDay
      );

      res.json({
        success: true,
        stats: {
          todayBookings,
          pendingBookings,
          activeStaffCount,
          revenue: revenueStats,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Shop Invoices
   */
  async getShopInvoices(req, res, next) {
    try {
      const { shopId } = req.params;
      const { status, startDate, endDate } = req.query;
      const tenantId = req.tenantId;

      const invoices = await invoiceService.getShopInvoices(tenantId, shopId, {
        status,
        startDate,
        endDate,
      });

      res.json({
        success: true,
        invoices,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ClientAdminController();

