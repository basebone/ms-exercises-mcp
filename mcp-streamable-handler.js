const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { ContentItems, UserFitnessProfile } = require('@baseplay/models');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

class StreamableHTTPMCPServer {
  constructor(userContext = null) {
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
    this.userContext = userContext; // Store authenticated user info
    this.setupHandlers();
  }

  setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_user_fitness_profile',
            description: 'Retrieve the authenticated user\'s fitness profile',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'create_workout_program',
            description: 'Create a workout program with multiple workouts in the database for the authenticated user',
            inputSchema: {
              type: 'object',
              properties: {
                program: {
                  type: 'object',
                  properties: {
                    title: { type: 'string', description: 'Program title' },
                    summary: { type: 'string', description: 'Program summary' },
                    description: { type: 'string', description: 'Program description' },
                    slug: { type: 'string', description: 'URL-friendly slug (optional, will be generated if not provided)' },
                    categories: { type: 'array', items: { type: 'string' }, description: 'Array of category IDs' },
                    creator: { type: 'string', description: 'Creator user ID (optional, will use authenticated user if not provided)' },
                    is_premium: { type: 'boolean', description: 'Whether the program is premium', default: false },
                    content_metadata: {
                      type: 'object',
                      properties: {
                        duration_weeks: { type: 'string', description: 'Program duration in weeks' },
                        frequency: { type: 'string', description: 'Workouts per week' },
                        difficulty: { type: 'string', description: 'Program difficulty level' },
                        workout_type: { type: 'string', description: 'Type of workout program' }
                      }
                    }
                  },
                  required: ['title', 'summary', 'description']
                },
                workouts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string', description: 'Workout title' },
                      summary: { type: 'string', description: 'Workout summary' },
                      description: { type: 'string', description: 'Workout description' },
                      slug: { type: 'string', description: 'URL-friendly slug (optional, will be generated if not provided)' },
                      categories: { type: 'array', items: { type: 'string' }, description: 'Array of category IDs' },
                      creator: { type: 'string', description: 'Creator user ID' },
                      is_premium: { type: 'boolean', description: 'Whether the workout is premium', default: false },
                      content_metadata: {
                        type: 'object',
                        properties: {
                          difficulty: { type: 'string', description: 'Workout difficulty level' },
                          calories_burned: { type: 'string', description: 'Estimated calories burned' },
                          location: { type: 'string', description: 'Workout location (e.g., home, gym)' },
                          workout_type: { type: 'string', description: 'Type of workout' },
                          total_duration: { type: 'number', description: 'Total workout duration in seconds' },
                          exercise_count: { type: 'number', description: 'Number of exercises in workout' }
                        }
                      },
                      sections: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            label: { type: 'string', description: 'Section label' },
                            position: { type: 'number', description: 'Section position' },
                            items: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  _id: { type: 'string', description: 'Exercise ID' },
                                  position: { type: 'number', description: 'Exercise position' },
                                  easy: { type: 'number', description: 'Duration for easy difficulty' },
                                  medium: { type: 'number', description: 'Duration for medium difficulty' },
                                  hard: { type: 'number', description: 'Duration for hard difficulty' }
                                },
                                required: ['_id', 'position', 'easy', 'medium', 'hard']
                              }
                            },
                            rest: { type: 'string', description: 'Rest time between exercises' },
                            reps: { type: 'string', description: 'Number of repetitions' }
                          },
                          required: ['label', 'position', 'items']
                        }
                      }
                    },
                    required: ['title', 'summary', 'description', 'creator', 'sections']
                  },
                  description: 'Array of workouts to create'
                },
                program_schedule: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      day: { type: 'number', description: 'Day number in the program' },
                      workout_index: { type: 'number', description: 'Index of the workout in the workouts array' }
                    },
                    required: ['day', 'workout_index']
                  },
                  description: 'Schedule mapping days to workout indices'
                }
              },
              required: ['program', 'workouts', 'program_schedule']
            }
          },
          {
            name: 'list_all_exercises',
            description: 'List all exercises from the database with complete details',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
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
          case 'get_user_fitness_profile':
            return await this.getUserFitnessProfile(args);
          case 'create_workout_program':
            return await this.createWorkoutProgram(args);
          case 'list_all_exercises':
            return await this.listAllExercises(args);
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

  // Static helper function to validate JWT token and extract user ID
  static validateJWTToken(authorization) {
    if (!authorization) {
      throw new Error('Authorization header is required');
    }

    // Check if authorization header starts with "Bearer "
    if (!authorization.startsWith('Bearer ')) {
      throw new Error('Authorization header must start with "Bearer "');
    }

    // Extract the token from "Bearer <token>"
    const token = authorization.substring(7);
    
    if (!token) {
      throw new Error('JWT token is required');
    }

    try {
      // Decode the JWT token without verification for now
      // In production, you should verify with a secret key
      const decoded = jwt.decode(token);
      
      if (!decoded) {
        throw new Error('Invalid JWT token format');
      }

      // Extract user ID from token
      const userId = decoded.user?._id || decoded._id || decoded.userId || decoded.sub;
      
      if (!userId) {
        throw new Error('User ID not found in JWT token. Expected user._id, _id, userId, or sub field');
      }

      return { userId, decoded };
    } catch (error) {
      if (error.message.includes('User ID not found') || error.message.includes('Invalid JWT token')) {
        throw error;
      }
      throw new Error(`JWT token validation failed: ${error.message}`);
    }
  }

  // Helper function to calculate age from date of birth
  calculateAge(dateOfBirth) {
    if (!dateOfBirth) return null;
    
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  }

  // Helper function to calculate BMI
  calculateBMI(weight, height) {
    if (!weight || !height) return null;
    
    // Convert height from cm to meters if needed
    const heightInMeters = height > 10 ? height / 100 : height;
    const bmi = weight / (heightInMeters * heightInMeters);
    
    return Math.round(bmi * 10) / 10; // Round to 1 decimal place
  }

  // Helper function to calculate BMR (Basal Metabolic Rate)
  calculateBMR(weight, height, age, gender) {
    if (!weight || !height || !age || !gender) return null;
    
    // Convert height from cm to meters if needed for calculation
    const heightInCm = height > 10 ? height : height * 100;
    
    // Mifflin-St Jeor Equation
    let bmr;
    if (gender.toLowerCase() === 'male' || gender.toLowerCase() === 'm') {
      bmr = (10 * weight) + (6.25 * heightInCm) - (5 * age) + 5;
    } else if (gender.toLowerCase() === 'female' || gender.toLowerCase() === 'f') {
      bmr = (10 * weight) + (6.25 * heightInCm) - (5 * age) - 161;
    } else {
      // Use average for non-binary or unspecified
      const maleBMR = (10 * weight) + (6.25 * heightInCm) - (5 * age) + 5;
      const femaleBMR = (10 * weight) + (6.25 * heightInCm) - (5 * age) - 161;
      bmr = (maleBMR + femaleBMR) / 2;
    }
    
    return Math.round(bmr);
  }

  async getUserFitnessProfile(args) {
    console.log('getUserFitnessProfile called with args:', args);
    
    // Use server-level authenticated user context
    if (!this.userContext) {
      throw new Error('User authentication required at server level');
    }
    
    const userId = this.userContext.userId;
    console.log('Using server-level authenticated user ID:', userId);
    
    try {
      // Query the UserFitnessProfile model for the user's fitness profile
      const fitnessProfile = await UserFitnessProfile.findOne({
        user_id: userId
      }).lean();

      if (!fitnessProfile) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                message: 'No fitness profile found for this user',
                user_id: userId
              }, null, 2)
            }
          ]
        };
      }

      console.log('Fitness profile found for user:', userId);

      // Calculate age from date of birth
      const age = this.calculateAge(fitnessProfile.date_of_birth || fitnessProfile.dateOfBirth || fitnessProfile.birth_date);
      
      // Get current weight (try multiple field names)
      const currentWeight = fitnessProfile.current_weight || fitnessProfile.weight;
      
      // Calculate BMI
      const bmi = this.calculateBMI(currentWeight, fitnessProfile.height);
      
      // Calculate BMR
      const bmr = this.calculateBMR(
        currentWeight,
        fitnessProfile.height,
        age,
        fitnessProfile.gender
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              user_id: userId,
              fitness_profile: {
                fitness_target: fitnessProfile.fitness_target || fitnessProfile.fitness_goals || fitnessProfile.goal || fitnessProfile.fitness_goal,
                gender: fitnessProfile.gender,
                current_weight: currentWeight,
                fitness_level: fitnessProfile.fitness_level || fitnessProfile.activity_level,
                age: age,
                height: fitnessProfile.height,
                target_weight: fitnessProfile.target_weight || fitnessProfile.goal_weight,
                bmi: bmi,
                bmr: bmr,
                physical_limitations: Boolean(fitnessProfile.physical_limitations || fitnessProfile.medical_conditions)
              }
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error('Error in getUserFitnessProfile:', error);
      throw new Error(`Failed to retrieve user fitness profile: ${error.message}`);
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
          content_metadata: 1
        }
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
              content_metadata: exercise.content_metadata
            })),
            total: exercises.length
          }, null, 2)
        }
      ]
    };
  }


  // Helper function to generate slug from title
  generateSlug(title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .trim('-'); // Remove leading/trailing hyphens
  }

  // Helper function to create locale array
  createLocaleArray(title, summary, description, language = 'en') {
    return [{
      language_iso: language,
      title,
      summary,
      description,
      seo_title: null,
      seo_summary: null,
      seo_description: null,
      specify_seo_values: false
    }];
  }

  // Helper function to create default content item structure
  createDefaultContentItem(type) {
    const now = new Date();
    return {
      _id: uuidv4(),
      item_type: type,
      content_type: type,
      media: [],
      content: {
        src: null,
        extension: null,
        text: null,
        quality: null,
        size: null,
        size_unit: null
      },
      settings: {
        is_exclusive: false,
        is_premium: false,
        allowed_domains: [],
        excluded_domains: [],
        excluded_countries_iso: [],
        excluded_network_endpoints: [],
        age_rating: 'PG'
      },
      social_stats: {
        likes: 0,
        comments: 0,
        views: 0,
        rating: 0
      },
      top_comments: [{
        id: null,
        user_id: null,
        commentor_name: null,
        comment: null,
        parent_id: null,
        ancestor_ids: [],
        created_at: null
      }],
      collections: [],
      is_indexed: true,
      locks: {
        is_locked_for_editing: false,
        current_editor: null,
        is_locked_for_moderation_process: false,
        is_locked_for_backend_process: false,
        current_backend_process: null
      },
      internal_meta: {
        rating: 5,
        tags: []
      },
      language: 'en',
      published_at: now,
      collection_type: type,
      is_featured: false,
      is_spotlight: false,
      contents: [],
      created_at: now,
      updated_at: now,
      __v: 0,
      curation_scores: {
        usage: 0,
        recent_usage: 0,
        os: { android: 0, ios: 0, windows: 0, mac: 0 },
        featured: { baseplay_theme_base: 0, baseplay_theme_one: 0, baseplay_theme_two: 0, baseplay_theme_three: 0, baseplay_theme_four: 0 },
        trending: { baseplay_theme_base: 0, baseplay_theme_one: 0, baseplay_theme_two: 0, baseplay_theme_three: 0, baseplay_theme_four: 0 },
        spotlight: { baseplay_theme_base: 0, baseplay_theme_one: 0, baseplay_theme_two: 0, baseplay_theme_three: 0, baseplay_theme_four: 0 },
        topten: { baseplay_theme_base: 0, baseplay_theme_one: 0, baseplay_theme_two: 0, baseplay_theme_three: 0, baseplay_theme_four: 0 },
        topics: { baseplay_theme_base: 0, baseplay_theme_one: 0, baseplay_theme_two: 0, baseplay_theme_three: 0, baseplay_theme_four: 0 }
      }
    };
  }

  async listAllExercises(args) {
    console.log('listAllExercises called with args:', args);
    
    try {
      // Build aggregation pipeline for English locale filtering (same as resource)
      const pipeline = [
        // Stage 1: Match exercises with content_metadata and specific category
        {
          $match: {
            item_type: 'exercise',
            content_metadata: { $exists: true, $ne: null },
            categories: 'a4e765cb-70d7-477a-984c-9fc25bf99bd1'
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
            content_metadata: 1
          }
        }
      ];

      console.log('listAllExercises - executing aggregation pipeline');
      const exercises = await ContentItems.aggregate(pipeline);
      console.log(`listAllExercises - found ${exercises.length} exercises`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              exercises: exercises.map(exercise => ({
                id: exercise._id,
                slug: exercise.slug,
                title: exercise.title || 'Untitled Exercise',
                description: exercise.description,
                media: exercise.media,
                content_metadata: exercise.content_metadata
              })),
              total: exercises.length
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error('Error in listAllExercises:', error);
      throw new Error(`Failed to list exercises: ${error.message}`);
    }
  }

  async createWorkoutProgram(args) {
    console.log('createWorkoutProgram called with args:', JSON.stringify(args, null, 2));
    
    const { program, workouts, program_schedule } = args;
    
    // Use server-level authenticated user context
    if (!this.userContext) {
      throw new Error('User authentication required at server level');
    }
    
    const userId = this.userContext.userId;
    console.log('Using server-level authenticated user ID for createWorkoutProgram:', userId);
    
    // Validate required fields
    if (!program || !workouts || !program_schedule) {
      throw new Error('Missing required fields: program, workouts, and program_schedule are required');
    }
    
    if (!Array.isArray(workouts) || workouts.length === 0) {
      throw new Error('At least one workout is required');
    }
    
    if (!Array.isArray(program_schedule) || program_schedule.length === 0) {
      throw new Error('Program schedule is required');
    }
    
    // Validate program schedule references
    for (const scheduleItem of program_schedule) {
      if (scheduleItem.workout_index >= workouts.length || scheduleItem.workout_index < 0) {
        throw new Error(`Invalid workout_index ${scheduleItem.workout_index} in program_schedule. Must be between 0 and ${workouts.length - 1}`);
      }
    }
    
    try {
      console.log('Starting workout program creation...');
      
      // Step 1: Create all workouts first
      const createdWorkouts = [];
      
      for (let i = 0; i < workouts.length; i++) {
        const workout = workouts[i];
        console.log(`Creating workout ${i + 1}/${workouts.length}: ${workout.title}`);
        
        // Create workout document
        const workoutDoc = this.createDefaultContentItem('workouts');
        
        // Set workout-specific fields
        workoutDoc.slug = workout.slug || this.generateSlug(workout.title);
        workoutDoc.locale = this.createLocaleArray(workout.title, workout.summary, workout.description);
        workoutDoc.creator = workout.creator || userId; // Use authenticated user if creator not specified
        workoutDoc.categories = workout.categories || [];
        workoutDoc.settings.is_premium = workout.is_premium || false;
        workoutDoc.content_metadata = workout.content_metadata || {};
        workoutDoc.sections = workout.sections || [];
        
        // Calculate total duration from sections if not provided
        if (!workoutDoc.content_metadata.total_duration && workout.sections) {
          let totalDuration = 0;
          let exerciseCount = 0;
          
          for (const section of workout.sections) {
            if (section.items) {
              for (const item of section.items) {
                // Use medium difficulty as default for duration calculation
                totalDuration += item.medium || item.easy || item.hard || 0;
                exerciseCount++;
              }
            }
          }
          
          workoutDoc.content_metadata.total_duration = totalDuration;
          workoutDoc.content_metadata.exercise_count = exerciseCount;
        }
        
        // Save workout to database
        const savedWorkout = await ContentItems.create(workoutDoc);
        createdWorkouts.push(savedWorkout);
        console.log(`Workout created with ID: ${savedWorkout._id}`);
      }
      
      // Step 2: Create the program with references to the created workouts
      console.log('Creating workout program...');
      
      const programDoc = this.createDefaultContentItem('workout-program');
      
      // Set program-specific fields
      programDoc.slug = program.slug || this.generateSlug(program.title);
      programDoc.locale = this.createLocaleArray(program.title, program.summary, program.description);
      programDoc.creator = program.creator || userId; // Use authenticated user if creator not specified
      programDoc.categories = program.categories || [];
      programDoc.settings.is_premium = program.is_premium || false;
      programDoc.content_metadata = program.content_metadata || {};
      
      // Create sections array mapping days to workout IDs
      programDoc.sections = program_schedule.map(scheduleItem => {
        const workout = createdWorkouts[scheduleItem.workout_index];
        return {
          day: scheduleItem.day,
          duration: workout.content_metadata?.total_duration || 0,
          workout: workout._id
        };
      });
      
      // Save program to database
      const savedProgram = await ContentItems.create(programDoc);
      console.log(`Program created with ID: ${savedProgram._id}`);
      
      // Return success response
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              authenticated_user: userId,
              program: {
                id: savedProgram._id,
                title: program.title,
                slug: savedProgram.slug,
                creator: savedProgram.creator,
                created_at: savedProgram.created_at
              },
              workouts: createdWorkouts.map((workout, index) => ({
                id: workout._id,
                title: workouts[index].title,
                slug: workout.slug,
                created_at: workout.created_at
              })),
              schedule: programDoc.sections,
              message: `Successfully created workout program '${program.title}' with ${createdWorkouts.length} workouts`
            }, null, 2)
          }
        ]
      };
      
    } catch (error) {
      console.error('Error in createWorkoutProgram:', error);
      throw new Error(`Failed to create workout program: ${error.message}`);
    }
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
        case 'get_user_fitness_profile':
          return await this.getUserFitnessProfile(args);
        case 'create_workout_program':
          return await this.createWorkoutProgram(args);
        case 'list_all_exercises':
          return await this.listAllExercises(args);
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

// Export the class for testing
module.exports = { StreamableHTTPMCPServer };

// Streamable HTTP POST handler - for sending messages to server
exports.mcpPost = async (event) => {
  console.log('MCP POST Handler called with:', {
    method: event.httpMethod,
    path: event.path,
    headers: event.headers,
    body: event.body?.substring(0, 200) + '...'
  });

  try {
    // Extract and validate JWT token from Authorization header
    const authorization = event.headers?.authorization || event.headers?.Authorization;
    
    if (!authorization) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Authentication required',
            data: 'Authorization header with Bearer token is required'
          },
          id: null
        })
      };
    }

    // Validate JWT token and extract user context
    let userContext;
    try {
      userContext = StreamableHTTPMCPServer.validateJWTToken(authorization);
      console.log('JWT validation successful, user ID:', userContext.userId);
    } catch (error) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Authentication failed',
            data: error.message
          },
          id: null
        })
      };
    }

    // Create server instance with authenticated user context
    const server = new StreamableHTTPMCPServer(userContext);
    
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
                  name: 'get_user_fitness_profile',
                  description: 'Retrieve the authenticated user\'s fitness profile',
                  inputSchema: {
                    type: 'object',
                    properties: {},
                    required: []
                  }
                },
                {
                  name: 'create_workout_program',
                  description: 'Create a workout program with multiple workouts in the database for the authenticated user',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      program: {
                        type: 'object',
                        properties: {
                          title: { type: 'string', description: 'Program title' },
                          summary: { type: 'string', description: 'Program summary' },
                          description: { type: 'string', description: 'Program description' },
                          slug: { type: 'string', description: 'URL-friendly slug (optional, will be generated if not provided)' },
                          categories: { type: 'array', items: { type: 'string' }, description: 'Array of category IDs' },
                          creator: { type: 'string', description: 'Creator user ID' },
                          is_premium: { type: 'boolean', description: 'Whether the program is premium', default: false },
                          content_metadata: {
                            type: 'object',
                            properties: {
                              duration_weeks: { type: 'string', description: 'Program duration in weeks' },
                              frequency: { type: 'string', description: 'Workouts per week' },
                              difficulty: { type: 'string', description: 'Program difficulty level' },
                              workout_type: { type: 'string', description: 'Type of workout program' }
                            }
                          }
                        },
                        required: ['title', 'summary', 'description', 'creator']
                      },
                      workouts: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            title: { type: 'string', description: 'Workout title' },
                            summary: { type: 'string', description: 'Workout summary' },
                            description: { type: 'string', description: 'Workout description' },
                            slug: { type: 'string', description: 'URL-friendly slug (optional, will be generated if not provided)' },
                            categories: { type: 'array', items: { type: 'string' }, description: 'Array of category IDs' },
                            creator: { type: 'string', description: 'Creator user ID' },
                            is_premium: { type: 'boolean', description: 'Whether the workout is premium', default: false },
                            content_metadata: {
                              type: 'object',
                              properties: {
                                difficulty: { type: 'string', description: 'Workout difficulty level' },
                                calories_burned: { type: 'string', description: 'Estimated calories burned' },
                                location: { type: 'string', description: 'Workout location (e.g., home, gym)' },
                                workout_type: { type: 'string', description: 'Type of workout' },
                                total_duration: { type: 'number', description: 'Total workout duration in seconds' },
                                exercise_count: { type: 'number', description: 'Number of exercises in workout' }
                              }
                            },
                            sections: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  label: { type: 'string', description: 'Section label' },
                                  position: { type: 'number', description: 'Section position' },
                                  items: {
                                    type: 'array',
                                    items: {
                                      type: 'object',
                                      properties: {
                                        _id: { type: 'string', description: 'Exercise ID' },
                                        position: { type: 'number', description: 'Exercise position' },
                                        easy: { type: 'number', description: 'Duration for easy difficulty' },
                                        medium: { type: 'number', description: 'Duration for medium difficulty' },
                                        hard: { type: 'number', description: 'Duration for hard difficulty' }
                                      },
                                      required: ['_id', 'position', 'easy', 'medium', 'hard']
                                    }
                                  },
                                  rest: { type: 'string', description: 'Rest time between exercises' },
                                  reps: { type: 'string', description: 'Number of repetitions' }
                                },
                                required: ['label', 'position', 'items']
                              }
                            }
                          },
                          required: ['title', 'summary', 'description', 'creator', 'sections']
                        },
                        description: 'Array of workouts to create'
                      },
                      program_schedule: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            day: { type: 'number', description: 'Day number in the program' },
                            workout_index: { type: 'number', description: 'Index of the workout in the workouts array' }
                          },
                          required: ['day', 'workout_index']
                        },
                        description: 'Schedule mapping days to workout indices'
                      }
                    },
                    required: ['program', 'workouts', 'program_schedule']
                  }
                },
                {
                  name: 'list_all_exercises',
                  description: 'List all exercises from the database with complete details',
                  inputSchema: {
                    type: 'object',
                    properties: {},
                    required: []
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
            'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin, Authorization',
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
            'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin, Authorization',
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
            'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin, Authorization',
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
  try {
    // Extract and validate JWT token from Authorization header
    const authorization = event.headers?.authorization || event.headers?.Authorization;
    
    if (!authorization) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Authentication required - Authorization header with Bearer token is required' })
      };
    }

    // Validate JWT token and extract user context
    let userContext;
    try {
      userContext = StreamableHTTPMCPServer.validateJWTToken(authorization);
      console.log('JWT validation successful for GET, user ID:', userContext.userId);
    } catch (error) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Authentication failed: ' + error.message })
      };
    }

    // Create server instance with authenticated user context
    const server = new StreamableHTTPMCPServer(userContext);
    
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
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin, Authorization',
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
