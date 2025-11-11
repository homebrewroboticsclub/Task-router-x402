const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const packageJson = require('../../package.json');

const swaggerDefinition = {
  openapi: '3.0.1',
  info: {
    title: 'x402 Raid App API',
    version: packageJson.version || '1.0.0',
    description: 'REST API for managing robots and orchestrating x402-enabled commands.',
  },
  tags: [
    { name: 'Health', description: 'Service diagnostics and readiness checks.' },
    { name: 'Robots', description: 'Robot registration, status, and lifecycle operations.' },
    { name: 'Commands', description: 'High-level actions dispatched to robots.' },
    { name: 'Payments', description: 'x402 payment verification and callbacks.' },
  ],
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Local development server',
    },
  ],
  components: {
    schemas: {
      RobotHealthStatus: {
        type: 'object',
        properties: {
          state: { type: 'string', example: 'ready' },
          message: { type: 'string', example: 'Ready for commands' },
          secure: { type: 'boolean', example: false },
          availableMethods: {
            type: 'array',
            items: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    path: { type: 'string', example: '/commands/dance' },
                    httpMethod: { type: 'string', example: 'POST' },
                    description: { type: 'string', example: 'Run demo dance routine.' },
                    pricing: {
                      type: 'object',
                      nullable: true,
                      properties: {
                        amount: { type: 'number', example: 0.001 },
                        assetSymbol: { type: 'string', example: 'SOL' },
                        receiverAccount: { type: 'string', example: 'So111...' },
                        paymentWindowSec: { type: 'integer', example: 180 },
                      },
                    },
                    parameters: { type: 'object' },
                  },
                },
              ],
            },
          },
          location: {
            type: 'object',
            nullable: true,
            properties: {
              lat: { type: 'number', example: 55.7522 },
              lng: { type: 'number', example: 37.6156 },
            },
          },
        },
      },
      Robot: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Robo-1' },
          host: { type: 'string', example: '192.168.1.10' },
          port: { type: 'integer', example: 8080 },
          requiresX402: { type: 'boolean', example: false },
          status: { $ref: '#/components/schemas/RobotHealthStatus' },
          lastHealthCheckAt: { type: 'string', format: 'date-time' },
        },
      },
      RegisterRobotRequest: {
        type: 'object',
        required: ['host', 'port'],
        properties: {
          name: { type: 'string' },
          host: { type: 'string', example: '192.168.1.10' },
          port: { type: 'integer', example: 8080 },
          requiresX402: { type: 'boolean', example: false },
        },
      },
      DanceCommandRequest: {
        type: 'object',
        required: ['quantity'],
        properties: {
          quantity: {
            oneOf: [
              { type: 'string', enum: ['all'] },
              { type: 'integer', enum: [1, 2] },
            ],
            example: 'all',
          },
        },
      },
      BuyColaCommandRequest: {
        type: 'object',
        required: ['location', 'quantity'],
        properties: {
          location: {
            type: 'object',
            required: ['lat', 'lng'],
            properties: {
              lat: { type: 'number', example: 55.7522 },
              lng: { type: 'number', example: 37.6156 },
            },
          },
          quantity: { type: 'integer', example: 3 },
        },
      },
    },
  },
};

const swaggerSpec = swaggerJsdoc({
  swaggerDefinition,
  apis: [
    path.join(__dirname, '../index.js'),
    path.join(__dirname, '../routes/*.js'),
  ],
});

module.exports = {
  swaggerSpec,
  swaggerUi,
};

