
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.UserScalarFieldEnum = {
  id: 'id',
  email: 'email',
  username: 'username',
  passwordHash: 'passwordHash',
  fullName: 'fullName',
  phone: 'phone',
  role: 'role',
  cityId: 'cityId',
  officeId: 'officeId',
  isActive: 'isActive',
  lastLoginAt: 'lastLoginAt',
  departmentId: 'departmentId',
  deskName: 'deskName',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CityScalarFieldEnum = {
  id: 'id',
  name: 'name',
  code: 'code',
  state: 'state',
  district: 'district',
  isActive: 'isActive',
  whatsappMonthlyLimit: 'whatsappMonthlyLimit',
  createdById: 'createdById',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.OperatorScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  cityId: 'cityId',
  createdById: 'createdById',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DocumentScalarFieldEnum = {
  id: 'id',
  title: 'title',
  originalName: 'originalName',
  storedName: 'storedName',
  fileUrl: 'fileUrl',
  fileSize: 'fileSize',
  mimeType: 'mimeType',
  uploadedById: 'uploadedById',
  cityId: 'cityId',
  recipientMobile: 'recipientMobile',
  status: 'status',
  messageType: 'messageType',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BulkOperationScalarFieldEnum = {
  id: 'id',
  name: 'name',
  cityId: 'cityId',
  operatorId: 'operatorId',
  documentId: 'documentId',
  csvFileUrl: 'csvFileUrl',
  channel: 'channel',
  provider: 'provider',
  totalRecipients: 'totalRecipients',
  queuedCount: 'queuedCount',
  sentCount: 'sentCount',
  deliveredCount: 'deliveredCount',
  readCount: 'readCount',
  failedCount: 'failedCount',
  status: 'status',
  startedAt: 'startedAt',
  completedAt: 'completedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.RecipientScalarFieldEnum = {
  id: 'id',
  cityId: 'cityId',
  operatorId: 'operatorId',
  documentId: 'documentId',
  bulkOperationId: 'bulkOperationId',
  fullName: 'fullName',
  mobile: 'mobile',
  status: 'status',
  sentAt: 'sentAt',
  deliveredAt: 'deliveredAt',
  readAt: 'readAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.MessageLogScalarFieldEnum = {
  id: 'id',
  recipientId: 'recipientId',
  cityId: 'cityId',
  operatorId: 'operatorId',
  bulkOperationId: 'bulkOperationId',
  documentId: 'documentId',
  recipientMobile: 'recipientMobile',
  body: 'body',
  provider: 'provider',
  channel: 'channel',
  providerMessageId: 'providerMessageId',
  payload: 'payload',
  providerResponse: 'providerResponse',
  error: 'error',
  retryCount: 'retryCount',
  status: 'status',
  sentAt: 'sentAt',
  deliveredAt: 'deliveredAt',
  readAt: 'readAt',
  lastRetryAt: 'lastRetryAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TemplateScalarFieldEnum = {
  id: 'id',
  cityId: 'cityId',
  name: 'name',
  channel: 'channel',
  provider: 'provider',
  body: 'body',
  metaTemplateName: 'metaTemplateName',
  languageCode: 'languageCode',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.MessagingSettingsScalarFieldEnum = {
  id: 'id',
  scope: 'scope',
  cityId: 'cityId',
  metaAccessToken: 'metaAccessToken',
  metaPhoneNumberId: 'metaPhoneNumberId',
  metaApiVersion: 'metaApiVersion',
  preferredProvider: 'preferredProvider',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuditLogScalarFieldEnum = {
  id: 'id',
  actorId: 'actorId',
  cityId: 'cityId',
  action: 'action',
  entityType: 'entityType',
  entityId: 'entityId',
  metadata: 'metadata',
  ipAddress: 'ipAddress',
  userAgent: 'userAgent',
  createdAt: 'createdAt'
};

exports.Prisma.OfficeScalarFieldEnum = {
  id: 'id',
  name: 'name',
  code: 'code',
  cityId: 'cityId',
  whatsappDisabled: 'whatsappDisabled',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DepartmentScalarFieldEnum = {
  id: 'id',
  name: 'name',
  code: 'code',
  headOfDepartmentId: 'headOfDepartmentId',
  cityId: 'cityId',
  officeId: 'officeId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TapalScalarFieldEnum = {
  id: 'id',
  trackingNumber: 'trackingNumber',
  type: 'type',
  subject: 'subject',
  currentHolderId: 'currentHolderId',
  status: 'status',
  cityId: 'cityId',
  officeId: 'officeId',
  departmentId: 'departmentId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.MovementScalarFieldEnum = {
  id: 'id',
  tapalId: 'tapalId',
  fromUserId: 'fromUserId',
  toUserId: 'toUserId',
  actionTaken: 'actionTaken',
  remarks: 'remarks',
  timestamp: 'timestamp'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};
exports.Role = exports.$Enums.Role = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  CITY_ADMIN: 'CITY_ADMIN',
  OPERATOR: 'OPERATOR',
  Clerk: 'Clerk',
  Superintendent: 'Superintendent',
  Officer: 'Officer',
  Admin: 'Admin'
};

exports.MessageType = exports.$Enums.MessageType = {
  SINGLE: 'SINGLE',
  BULK: 'BULK'
};

exports.Channel = exports.$Enums.Channel = {
  WHATSAPP: 'WHATSAPP',
  SMS: 'SMS',
  EMAIL: 'EMAIL'
};

exports.Provider = exports.$Enums.Provider = {
  META: 'META'
};

exports.BulkOperationStatus = exports.$Enums.BulkOperationStatus = {
  DRAFT: 'DRAFT',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
};

exports.MessageStatus = exports.$Enums.MessageStatus = {
  DRAFT: 'DRAFT',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
  RETRYING: 'RETRYING',
  CANCELLED: 'CANCELLED'
};

exports.SettingsScope = exports.$Enums.SettingsScope = {
  GLOBAL: 'GLOBAL',
  CITY: 'CITY'
};

exports.TapalType = exports.$Enums.TapalType = {
  Inward: 'Inward',
  Outward: 'Outward',
  Internal: 'Internal'
};

exports.TapalStatus = exports.$Enums.TapalStatus = {
  New: 'New',
  InProgress: 'InProgress',
  Resolved: 'Resolved',
  Returned: 'Returned'
};

exports.Prisma.ModelName = {
  User: 'User',
  City: 'City',
  Operator: 'Operator',
  Document: 'Document',
  BulkOperation: 'BulkOperation',
  Recipient: 'Recipient',
  MessageLog: 'MessageLog',
  Template: 'Template',
  MessagingSettings: 'MessagingSettings',
  AuditLog: 'AuditLog',
  Office: 'Office',
  Department: 'Department',
  Tapal: 'Tapal',
  Movement: 'Movement'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
