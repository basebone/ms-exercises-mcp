const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { ContentItems } = require('@baseplay/models');
const mongoose = require('mongoose');

class StreamableHTTPMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'exercise-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {
            listChanged: false
          },
          resources: {
            subscribe: false,
            listChanged: false
          }
        },
      }
    );

    this.sessions = new Map(); // Track active sessions
    this.setupHandlers();
  }

  setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_exercises',
            description: 'Retrieve exercises from the database with optional filtering',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of exercises to return (default: 10)',
                  default: 10
                },
                skip: {
                  type: 'number',
                  description: 'Number of exercises to skip for pagination (default: 0)',
                  default: 0
                },
                category: {
                  type: 'string',
                  description: 'Filter by exercise category'
                },
                search: {
                  type: 'string',
                  description: 'Search exercises by title or content'
                }
              }
            }
          },
          {
            name: 'get_exercise_by_id',
            description: 'Retrieve a specific exercise by its ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The exercise ID to retrieve',
                  required: true
                }
              },
              required: ['id']
            }
          },
          {
            name: 'search_exercises',
            description: 'Search exercises with advanced filtering options',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query for exercise content'
                },
                categories: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of category IDs to filter by'
                },
                difficulty: {
                  type: 'string',
                  description: 'Filter by difficulty level'
                },
                duration: {
                  type: 'object',
                  properties: {
                    min: { type: 'number' },
                    max: { type: 'number' }
                  },
                  description: 'Filter by exercise duration range'
                }
              }
            }
          }
        ]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        await this.ensureDbConnection();

        switch (name) {
          case 'get_exercises':
            return await this.getExercises(args);
          case 'get_exercise_by_id':
            return await this.getExerciseById(args);
          case 'search_exercises':
            return await this.searchExercises(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`
            }
          ],
          isError: true
        };
      }
    });

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: 'exercise://exercises',
            name: 'All Exercises',
            description: 'Complete list of all published exercises',
            mimeType: 'application/json'
          },
          {
            uri: 'exercise://categories',
            name: 'Exercise Categories',
            description: 'List of all exercise categories',
            mimeType: 'application/json'
          },
          {
            uri: 'exercise://stats',
            name: 'Exercise Statistics',
            description: 'Statistics about exercises in the database',
            mimeType: 'application/json'
          }
        ]
      };
    });

    // Handle resource reads
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      try {
        await this.ensureDbConnection();

        switch (uri) {
          case 'exercise://exercises':
            return await this.getAllExercisesResource();
          case 'exercise://categories':
            return await this.getCategoriesResource();
          case 'exercise://stats':
            return await this.getStatsResource();
          default:
            throw new Error(`Unknown resource: ${uri}`);
        }
      } catch (error) {
        return {
          contents: [
            {
              uri,
              mimeType: 'text/plain',
              text: `Error: ${error.message}`
            }
          ]
        };
      }
    });
  }

  validateOrigin(origin) {
    // Security: Validate Origin header to prevent DNS rebinding attacks
    // Allow requests without Origin header (common for MCP clients, CLI tools, etc.)
    if (!origin) {
      console.log('No Origin header provided - allowing for MCP client compatibility');
      return true;
    }
    
    // Allow localhost for development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return true;
    }
    
    // Add your allowed origins here
    const allowedOrigins = [
      'https://your-domain.com',
      'https://claude.ai',
      // Add other trusted origins
    ];
    
    return allowedOrigins.includes(origin);
  }

  async ensureDbConnection() {
    if (mongoose.connection.readyState === 0) {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/main_store';
      await mongoose.connect(mongoUri);
    }
  }

  async getExercises(args = {}) {
    console.log('getExercises called with args:', args);
    const { limit = 10, skip = 0, category, search } = args;
    
    // Build aggregation pipeline
    const pipeline = [];
    
    // Stage 1: Match exercises with content_metadata
    const matchStage = {
      $match: {
        item_type: 'exercise',
        content_metadata: { $exists: true, $ne: null }
      }
    };
    
    // Add category filter if specified
    if (category) {
      matchStage.$match.categories = category;
    }
    
    // Add search filter if specified (search in English locale)
    if (search) {
      matchStage.$match.$or = [
        { 'locale.title': { $regex: search, $options: 'i' } },
        { 'locale.description': { $regex: search, $options: 'i' } }
      ];
    }
    
    pipeline.push(matchStage);
    
    // Stage 2: Add field to extract English locale data
    pipeline.push({
      $addFields: {
        englishLocale: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$locale',
                cond: { $eq: ['$$this.language_iso', 'en'] }
              }
            },
            0
          ]
        }
      }
    });
    
    // Stage 3: Project only the required fields
    pipeline.push({
      $project: {
        _id: 1,
        slug: 1,
        title: '$englishLocale.title',
        description: '$englishLocale.description',
        media: 1,
        content_metadata: 1,
        published_at: 1,
        categories: 1
      }
    });
    
    // Stage 4: Sort by published_at descending
    pipeline.push({
      $sort: { published_at: -1 }
    });
    
    // Stage 5: Skip and limit for pagination
    if (skip > 0) {
      pipeline.push({ $skip: skip });
    }
    
    pipeline.push({ $limit: limit });

    console.log('MongoDB aggregation pipeline:', JSON.stringify(pipeline, null, 2));
    console.log('Query options - limit:', limit, 'skip:', skip);

    try {
      console.log('Executing MongoDB aggregation...');
      const startTime = Date.now();
      
      const exercises = await ContentItems.aggregate(pipeline);
      
      const queryTime = Date.now() - startTime;
      console.log(`MongoDB aggregation completed in ${queryTime}ms, found ${exercises.length} exercises`);
      
      if (exercises.length === 0) {
        console.log('No exercises found - this might indicate a database connection or data issue');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              exercises: exercises.map(exercise => ({
                id: exercise._id,
                slug: exercise.slug,
                title: exercise.title || 'Untitled Exercise',
                description: exercise.description,
                media: exercise.media,
                content_metadata: exercise.content_metadata,
                published_at: exercise.published_at,
                categories: exercise.categories
              })),
              total: exercises.length,
              limit,
              skip
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error('Error in getExercises:', error);
      throw new Error(`Failed to retrieve exercises: ${error.message}`);
    }
  }

  async getExerciseById(args) {
    const { id } = args;
    
    if (!id) {
      throw new Error('Exercise ID is required');
    }

    const exercise = await ContentItems.findOne({
      _id: id,
      item_type: 'exercise',
      content_metadata: { $exists: true, $ne: null }
    })
    .populate('categories')
    .populate('creator')
    .lean();

    if (!exercise) {
      throw new Error('Exercise not found');
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            exercise: {
              id: exercise._id,
              title: exercise.content?.title || 'Untitled Exercise',
              description: exercise.content?.description,
              content: exercise.content,
              categories: exercise.categories,
              creator: exercise.creator,
              published_at: exercise.published_at,
              content_type: exercise.content_type,
              media: exercise.media,
              settings: exercise.settings,
              sections: exercise.sections
            }
          }, null, 2)
        }
      ]
    };
  }

  async searchExercises(args = {}) {
    console.log('searchExercises called with args:', args);
    const { query, categories, difficulty, duration } = args;
    
    // Build aggregation pipeline
    const pipeline = [];
    
    // Stage 1: Match exercises with content_metadata and search criteria
    const matchStage = {
      $match: {
        item_type: 'exercise',
        content_metadata: { $exists: true, $ne: null }
      }
    };

    // Add categories filter if specified
    if (categories && categories.length > 0) {
      matchStage.$match.categories = { $in: categories };
    }

    // Add difficulty filter if specified
    if (difficulty) {
      matchStage.$match['settings.difficulty'] = difficulty;
    }

    // Add duration filter if specified
    if (duration) {
      if (duration.min !== undefined || duration.max !== undefined) {
        matchStage.$match['settings.duration'] = {};
        if (duration.min !== undefined) {
          matchStage.$match['settings.duration'].$gte = duration.min;
        }
        if (duration.max !== undefined) {
          matchStage.$match['settings.duration'].$lte = duration.max;
        }
      }
    }

    pipeline.push(matchStage);
    
    // Stage 2: Add field to extract English locale data
    pipeline.push({
      $addFields: {
        englishLocale: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$locale',
                cond: { $eq: ['$$this.language_iso', 'en'] }
              }
            },
            0
          ]
        }
      }
    });

    // Stage 3: Add text search filter if query is specified (search in English locale)
    if (query) {
      pipeline.push({
        $match: {
          $or: [
            { 'englishLocale.title': { $regex: query, $options: 'i' } },
            { 'englishLocale.description': { $regex: query, $options: 'i' } },
            { 'englishLocale.instructions': { $regex: query, $options: 'i' } }
          ]
        }
      });
    }
    
    // Stage 4: Project only the required fields
    pipeline.push({
      $project: {
        _id: 1,
        slug: 1,
        title: '$englishLocale.title',
        description: '$englishLocale.description',
        media: 1,
        content_metadata: 1,
        published_at: 1,
        categories: 1,
        difficulty: '$settings.difficulty',
        duration: '$settings.duration'
      }
    });
    
    // Stage 5: Sort by published_at descending
    pipeline.push({
      $sort: { published_at: -1 }
    });

    console.log('searchExercises - MongoDB aggregation pipeline:', JSON.stringify(pipeline, null, 2));

    try {
      console.log('searchExercises - executing aggregation...');
      const startTime = Date.now();
      
      const exercises = await ContentItems.aggregate(pipeline);
      
      const queryTime = Date.now() - startTime;
      console.log(`searchExercises - aggregation completed in ${queryTime}ms, found ${exercises.length} exercises`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              exercises: exercises.map(exercise => ({
                id: exercise._id,
                slug: exercise.slug,
                title: exercise.title || 'Untitled Exercise',
                description: exercise.description,
                media: exercise.media,
                content_metadata: exercise.content_metadata,
                categories: exercise.categories,
                difficulty: exercise.difficulty,
                duration: exercise.duration,
                published_at: exercise.published_at
              })),
              total: exercises.length,
              searchQuery: args
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error('Error in searchExercises:', error);
      throw new Error(`Failed to search exercises: ${error.message}`);
    }
  }

  async getAllExercisesResource() {
    // Build aggregation pipeline for English locale filtering
    const pipeline = [
      // Stage 1: Match exercises with content_metadata
      {
        $match: {
          item_type: 'exercise',
          content_metadata: { $exists: true, $ne: null }
        }
      },
      
      // Stage 2: Add field to extract English locale data
      {
        $addFields: {
          englishLocale: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$locale',
                  cond: { $eq: ['$$this.language_iso', 'en'] }
                }
              },
              0
            ]
          }
        }
      },
      
      // Stage 3: Project only the required fields
      {
        $project: {
          _id: 1,
          slug: 1,
          title: '$englishLocale.title',
          description: '$englishLocale.description',
          media: 1,
          content_metadata: 1,
          published_at: 1,
          categories: 1
        }
      },
      
      // Stage 4: Sort by published_at descending
      {
        $sort: { published_at: -1 }
      }
    ];

    console.log('getAllExercisesResource - executing aggregation pipeline');
    const exercises = await ContentItems.aggregate(pipeline);
    console.log(`getAllExercisesResource - found ${exercises.length} exercises`);

    return {
      contents: [
        {
          uri: 'exercise://exercises',
          mimeType: 'application/json',
          text: JSON.stringify({
            exercises: exercises.map(exercise => ({
              id: exercise._id,
              slug: exercise.slug,
              title: exercise.title || 'Untitled Exercise',
              description: exercise.description,
              media: exercise.media,
              content_metadata: exercise.content_metadata,
              categories: exercise.categories,
              published_at: exercise.published_at
            })),
            total: exercises.length
          }, null, 2)
        }
      ]
    };
  }

  async getCategoriesResource() {
    const categories = await ContentItems.distinct('categories', {
      item_type: 'exercise',
      content_metadata: { $exists: true, $ne: null }
    });

    return {
      contents: [
        {
          uri: 'exercise://categories',
          mimeType: 'application/json',
          text: JSON.stringify({
            categories,
            total: categories.length
          }, null, 2)
        }
      ]
    };
  }

  async getStatsResource() {
    const stats = await ContentItems.aggregate([
      {
        $match: {
          item_type: 'exercise',
          content_metadata: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          avgDuration: { $avg: '$settings.duration' },
          categories: { $addToSet: '$categories' }
        }
      }
    ]);

    const categoryCount = await ContentItems.distinct('categories', {
      item_type: 'exercise',
      content_metadata: { $exists: true, $ne: null }
    });

    return {
      contents: [
        {
          uri: 'exercise://stats',
          mimeType: 'application/json',
          text: JSON.stringify({
            totalExercises: stats[0]?.total || 0,
            averageDuration: stats[0]?.avgDuration || 0,
            totalCategories: categoryCount.length,
            lastUpdated: new Date().toISOString()
          }, null, 2)
        }
      ]
    };
  }

  // Create SSE stream response
  createSSEResponse(sessionId) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'X-Session-ID': sessionId
      },
      body: '', // Will be populated with SSE data
      isBase64Encoded: false
    };
  }

  // Format message as SSE event
  formatSSEMessage(data, event = 'message', id = null) {
    let message = '';
    if (id) message += `id: ${id}\n`;
    if (event) message += `event: ${event}\n`;
    message += `data: ${JSON.stringify(data)}\n\n`;
    return message;
  }

  // Handle tool calls directly
  async handleToolCall(params) {
    const { name, arguments: args } = params;

    try {
      await this.ensureDbConnection();

      switch (name) {
        case 'get_exercises':
          return await this.getExercises(args);
        case 'get_exercise_by_id':
          return await this.getExerciseById(args);
        case 'search_exercises':
          return await this.searchExercises(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }

  // Handle resource reads directly
  async handleResourceRead(params) {
    const { uri } = params;

    try {
      await this.ensureDbConnection();

      switch (uri) {
        case 'exercise://exercises':
          return await this.getAllExercisesResource();
        case 'exercise://categories':
          return await this.getCategoriesResource();
        case 'exercise://stats':
          return await this.getStatsResource();
        default:
          throw new Error(`Unknown resource: ${uri}`);
      }
    } catch (error) {
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: `Error: ${error.message}`
          }
        ]
      };
    }
  }
}

// Streamable HTTP POST handler - for sending messages to server
exports.mcpPost = async (event) => {
  console.log('MCP POST Handler called with:', {
    method: event.httpMethod,
    path: event.path,
    headers: event.headers,
    body: event.body?.substring(0, 200) + '...'
  });

  const server = new StreamableHTTPMCPServer();
  
  try {
    // Validate Origin header for security
    const origin = event.headers?.origin || event.headers?.Origin;
    console.log('Origin validation:', { origin, isValid: server.validateOrigin(origin) });
    
    if (!server.validateOrigin(origin)) {
      console.log('Origin validation failed');
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ error: 'Invalid origin' })
      };
    }

    // Parse the JSON-RPC message
    const mcpMessage = JSON.parse(event.body || '{}');
    console.log('Parsed MCP message:', mcpMessage);
    
    // Check Accept header
    const accept = event.headers?.accept || event.headers?.Accept || '';
    const supportsSSE = accept.includes('text/event-stream');
    const supportsJSON = accept.includes('application/json');

    console.log('Accept header analysis:', { accept, supportsSSE, supportsJSON });

    if (!supportsSSE && !supportsJSON) {
      console.log('Invalid Accept header');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Must accept application/json or text/event-stream' })
      };
    }

    // Handle different message types
    if (mcpMessage.method) {
      console.log('Processing JSON-RPC request:', mcpMessage.method);
      
      // Handle the request directly instead of using server.request
      let response;
      
      switch (mcpMessage.method) {
        case 'initialize':
          console.log('Handling initialize request');
          response = {
            jsonrpc: '2.0',
            id: mcpMessage.id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: {
                tools: {},
                resources: {},
                prompts: {},
                logging: {}
              },
              serverInfo: {
                name: 'ms-exercise-mcp',
                version: '1.0.0'
              }
            }
          };
          break;
          
        case 'tools/list':
          console.log('Handling tools/list request');
          response = {
            jsonrpc: '2.0',
            id: mcpMessage.id,
            result: {
              tools: [
                {
                  name: 'get_exercises',
                  description: 'Retrieve exercises from the database with optional filtering',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      limit: { type: 'number', description: 'Maximum number of exercises to return (default: 10)', default: 10 },
                      skip: { type: 'number', description: 'Number of exercises to skip for pagination (default: 0)', default: 0 },
                      category: { type: 'string', description: 'Filter by exercise category' },
                      search: { type: 'string', description: 'Search exercises by title or content' }
                    }
                  }
                },
                {
                  name: 'get_exercise_by_id',
                  description: 'Retrieve a specific exercise by its ID',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', description: 'The exercise ID to retrieve', required: true }
                    },
                    required: ['id']
                  }
                },
                {
                  name: 'search_exercises',
                  description: 'Search exercises with advanced filtering options',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      query: { type: 'string', description: 'Search query for exercise content' },
                      categories: { type: 'array', items: { type: 'string' }, description: 'Array of category IDs to filter by' },
                      difficulty: { type: 'string', description: 'Filter by difficulty level' },
                      duration: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } }, description: 'Filter by exercise duration range' }
                    }
                  }
                }
              ]
            }
          };
          break;
          
        case 'resources/list':
          console.log('Handling resources/list request');
          response = {
            jsonrpc: '2.0',
            id: mcpMessage.id,
            result: {
              resources: [
                {
                  uri: 'exercise://exercises',
                  name: 'All Exercises',
                  description: 'Complete list of all published exercises',
                  mimeType: 'application/json'
                },
                {
                  uri: 'exercise://categories',
                  name: 'Exercise Categories',
                  description: 'List of all exercise categories',
                  mimeType: 'application/json'
                },
                {
                  uri: 'exercise://stats',
                  name: 'Exercise Statistics',
                  description: 'Statistics about exercises in the database',
                  mimeType: 'application/json'
                }
              ]
            }
          };
          break;
          
        case 'tools/call':
          console.log('Handling tools/call request:', mcpMessage.params);
          try {
            console.log('About to call handleToolCall...');
            const toolResult = await server.handleToolCall(mcpMessage.params);
            console.log('handleToolCall completed, result:', toolResult ? 'success' : 'no result');
            response = {
              jsonrpc: '2.0',
              id: mcpMessage.id,
              result: toolResult
            };
            console.log('tools/call response prepared');
          } catch (error) {
            console.error('Error in tools/call:', error);
            response = {
              jsonrpc: '2.0',
              id: mcpMessage.id,
              error: {
                code: -32603,
                message: 'Internal error',
                data: error.message
              }
            };
          }
          break;
          
        case 'resources/read':
          console.log('Handling resources/read request:', mcpMessage.params);
          const resourceResult = await server.handleResourceRead(mcpMessage.params);
          response = {
            jsonrpc: '2.0',
            id: mcpMessage.id,
            result: resourceResult
          };
          break;
          
        default:
          console.log('Unknown method:', mcpMessage.method);
          response = {
            jsonrpc: '2.0',
            id: mcpMessage.id,
            error: {
              code: -32601,
              message: 'Method not found',
              data: `Unknown method: ${mcpMessage.method}`
            }
          };
      }
      
      console.log('Generated response:', response);
      console.log('Response handling - supportsSSE:', supportsSSE, 'supportsJSON:', supportsJSON);
      
      // For MCP protocol methods, prefer JSON responses for better compatibility
      const preferJSON = ['initialize', 'tools/list', 'resources/list', 'tools/call', 'resources/read'].includes(mcpMessage.method);
      console.log('Method:', mcpMessage.method, 'preferJSON:', preferJSON);
      
      if (supportsJSON && (preferJSON || !supportsSSE)) {
        // Return JSON response
        console.log('Sending JSON response');
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
          },
          body: JSON.stringify(response)
        };
      } else if (supportsSSE) {
        // Return SSE stream with the response
        console.log('Sending SSE response');
        const sessionId = Date.now().toString();
        const sseResponse = server.formatSSEMessage(response, 'response', mcpMessage.id);
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'X-Session-ID': sessionId
          },
          body: sseResponse,
          isBase64Encoded: false
        };
      } else {
        // Fallback to JSON
        console.log('Fallback to JSON response');
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
          },
          body: JSON.stringify(response)
        };
      }
    } else if (mcpMessage.result !== undefined || mcpMessage.error !== undefined) {
      // This is a JSON-RPC response or notification
      return {
        statusCode: 202, // Accepted
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        },
        body: ''
      };
    } else {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON-RPC message' })
      };
    }
    
  } catch (error) {
    console.error('MCP POST Handler Error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message
        },
        id: null
      })
    };
  }
};

// Streamable HTTP GET handler - for listening to server messages via SSE
exports.mcpGet = async (event) => {
  const server = new StreamableHTTPMCPServer();
  
  try {
    // Validate Origin header for security
    const origin = event.headers?.origin || event.headers?.Origin;
    if (!server.validateOrigin(origin)) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ error: 'Invalid origin' })
      };
    }

    // Check Accept header
    const accept = event.headers?.accept || event.headers?.Accept || '';
    if (!accept.includes('text/event-stream')) {
      return {
        statusCode: 405,
        headers: {
          'Content-Type': 'application/json',
          'Allow': 'POST'
        },
        body: JSON.stringify({ error: 'Method Not Allowed - must accept text/event-stream' })
      };
    }

    // Create SSE stream for server-initiated messages
    const sessionId = Date.now().toString();
    
    // For now, just return an empty SSE stream
    // In a full implementation, this would maintain persistent connections
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'X-Session-ID': sessionId
      },
      body: server.formatSSEMessage({ type: 'connected', sessionId }, 'connected'),
      isBase64Encoded: false
    };
    
  } catch (error) {
    console.error('MCP GET Handler Error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Handle OPTIONS requests for CORS
exports.mcpOptions = async (event) => {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    },
    body: ''
  };
};

module.exports = { 
  StreamableHTTPMCPServer,
  mcpPost: exports.mcpPost,
  mcpGet: exports.mcpGet,
  mcpOptions: exports.mcpOptions
};
