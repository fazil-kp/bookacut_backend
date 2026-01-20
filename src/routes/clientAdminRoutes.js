const express = require('express');
const router = express.Router();
const clientAdminController = require('../controllers/clientAdminController');
const { authenticate } = require('../middlewares/auth');
const { validateTenant, extractTenantId } = require('../middlewares/tenant');
const { requireRole, requirePermission, validateShopAccess } = require('../middlewares/rbac');
const { validateSubscription } = require('../middlewares/subscription');
const { ROLES } = require('../config/constants');
const { body } = require('express-validator');
const { validate } = require('../middlewares/validator');

/**
 * Client Admin Routes
 * All routes require client_admin role
 */

// Apply authentication and tenant validation to all routes
router.use(authenticate);
router.use(validateTenant);
router.use(validateSubscription);
router.use(requireRole(ROLES.CLIENT_ADMIN, ROLES.PLATFORM_SUPER_ADMIN));

// Shop Management
router.post(
  '/shops',
  [
    body('name').notEmpty().trim(),
    body('phone').notEmpty(),
    validate,
  ],
  clientAdminController.createShop.bind(clientAdminController)
);

router.get('/shops', clientAdminController.getShops.bind(clientAdminController));

router.get('/shops/:shopId', validateShopAccess, clientAdminController.getShop.bind(clientAdminController));

router.put(
  '/shops/:shopId',
  validateShopAccess,
  clientAdminController.updateShop.bind(clientAdminController)
);

// Staff Management
router.post(
  '/shops/:shopId/staff',
  validateShopAccess,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('phone').notEmpty(),
    body('firstName').notEmpty().trim(),
    body('lastName').notEmpty().trim(),
    validate,
  ],
  clientAdminController.addStaff.bind(clientAdminController)
);

router.get(
  '/shops/:shopId/staff',
  validateShopAccess,
  clientAdminController.getShopStaff.bind(clientAdminController)
);

router.delete(
  '/shops/:shopId/staff/:staffId',
  validateShopAccess,
  clientAdminController.removeStaff.bind(clientAdminController)
);

router.put(
  '/shops/:shopId/staff/:staffId/password',
  validateShopAccess,
  [
    body('password').isLength({ min: 6 }),
    validate,
  ],
  clientAdminController.updateStaffPassword.bind(clientAdminController)
);

router.put(
  '/shops/:shopId/staff/:staffId/credentials',
  validateShopAccess,
  [
    body('email').optional().isEmail().normalizeEmail(),
    body('password').optional().isLength({ min: 6 }),
    validate,
  ],
  clientAdminController.updateStaffCredentials.bind(clientAdminController)
);

// Service Management
router.post(
  '/shops/:shopId/services',
  validateShopAccess,
  [
    body('name').notEmpty().trim(),
    body('duration').isInt({ min: 1 }),
    body('price').isFloat({ min: 0 }),
    validate,
  ],
  clientAdminController.createService.bind(clientAdminController)
);

router.get(
  '/shops/:shopId/services',
  validateShopAccess,
  clientAdminController.getShopServices.bind(clientAdminController)
);

// Shop Settings
router.put(
  '/shops/:shopId/settings',
  validateShopAccess,
  clientAdminController.updateShopSettings.bind(clientAdminController)
);

// Slot Management
router.post(
  '/shops/:shopId/slots/generate',
  validateShopAccess,
  [
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
    validate,
  ],
  clientAdminController.generateSlots.bind(clientAdminController)
);

// Block slot by date and time (Preferred method)
router.post(
  '/shops/:shopId/slots/block',
  validateShopAccess,
  [
    body('date').isISO8601().toDate(),
    body('slotTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('slotTime must be in HH:mm format'),
    body('reason').optional().trim(),
    validate,
  ],
  clientAdminController.blockSlot.bind(clientAdminController)
);

// Block slot by slotId (Alternative method)
router.post(
  '/shops/:shopId/slots/:slotId/block',
  validateShopAccess,
  [
    body('reason').optional().trim(),
    validate,
  ],
  clientAdminController.blockSlotById.bind(clientAdminController)
);

// Unblock slot by date and time (Preferred method)
router.post(
  '/shops/:shopId/slots/unblock',
  validateShopAccess,
  [
    body('date').isISO8601().toDate(),
    body('slotTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('slotTime must be in HH:mm format'),
    validate,
  ],
  clientAdminController.unblockSlot.bind(clientAdminController)
);

// Unblock slot by slotId (Alternative method)
router.post(
  '/shops/:shopId/slots/:slotId/unblock',
  validateShopAccess,
  clientAdminController.unblockSlotById.bind(clientAdminController)
);

router.put(
  '/shops/:shopId/slots/:slotId/capacity',
  validateShopAccess,
  [
    body('capacity').isInt({ min: 1 }),
    validate,
  ],
  clientAdminController.reduceSlotCapacity.bind(clientAdminController)
);

// Dashboard & Reports
router.get(
  '/shops/:shopId/dashboard',
  validateShopAccess,
  clientAdminController.getDashboardStats.bind(clientAdminController)
);

router.get(
  '/shops/:shopId/invoices',
  validateShopAccess,
  clientAdminController.getShopInvoices.bind(clientAdminController)
);

module.exports = router;

