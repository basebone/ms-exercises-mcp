<!--
title: 'AWS Simple HTTP Endpoint example in NodeJS'
description: 'This template demonstrates how to make a simple HTTP API with Node.js running on AWS Lambda and API Gateway using the Serverless Framework.'
layout: Doc
framework: v4
platform: AWS
language: nodeJS
authorLink: 'https://github.com/serverless'
authorName: 'Serverless, Inc.'
authorAvatar: 'https://avatars1.githubusercontent.com/u/13742415?s=200&v=4'
-->

# Exercise MCP Server - Serverless Framework

This project provides a Model Context Protocol (MCP) compatible endpoint for accessing exercise data from a MongoDB database using the @baseplay/models package. The server is built with Node.js and deployed using the Serverless Framework on AWS Lambda.

## Features

- **MCP Compatible**: Fully compliant with the Model Context Protocol specification (2025-06-18)
- **Exercise Data Access**: Retrieve exercises filtered by `item_type: 'exercise'` and `published_at: not null`
- **Multiple Access Patterns**: Supports both tools and resources for different use cases
- **Serverless Deployment**: Runs on AWS Lambda with API Gateway
- **MongoDB Integration**: Uses @baseplay/models ContentItems model for data access

## MCP Tools Available

The server provides the following MCP tools for accessing exercise data:

### 1. `get_exercises`
Retrieve exercises with optional filtering and pagination.

**Parameters:**
- `limit` (number, default: 10): Maximum number of exercises to return
- `skip` (number, default: 0): Number of exercises to skip for pagination
- `category` (string): Filter by exercise category
- `search` (string): Search exercises by title or content

### 2. `get_exercise_by_id`
Retrieve a specific exercise by its ID.

**Parameters:**
- `id` (string, required): The exercise ID to retrieve

### 3. `search_exercises`
Advanced search with multiple filtering options.

**Parameters:**
- `query` (string): Search query for exercise content
- `categories` (array): Array of category IDs to filter by
- `difficulty` (string): Filter by difficulty level
- `duration` (object): Filter by exercise duration range with `min` and `max` properties

## MCP Resources Available

The server provides the following MCP resources:

### 1. `exercise://exercises`
Complete list of all published exercises in JSON format.

### 2. `exercise://categories`
List of all exercise categories in JSON format.

### 3. `exercise://stats`
Statistics about exercises in the database including total count, average duration, and category count.

## Setup and Configuration

### Prerequisites

1. Node.js 20.x or later
2. MongoDB database with exercise data
3. AWS CLI configured (for deployment)
4. Serverless Framework installed globally

### Environment Variables

Set the following environment variable for MongoDB connection:

```bash
export MONGODB_URI="mongodb://your-mongodb-connection-string"
```

### Installation

1. Install dependencies:
```bash
npm install
```

2. Test the MCP server locally:
```bash
node test-mcp.js
```

### Deployment

Deploy the MCP server to AWS:

```bash
serverless deploy
```

After deployment, you'll get an endpoint like:
```
https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/mcp
```

### Usage with MCP Clients

The deployed endpoint accepts MCP requests via POST to `/mcp`. Example MCP request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

### Local Development

For local development and testing, you can run the MCP server locally using serverless-offline:

```bash
# Start the local server on port 3001
npm run dev
# or
npm start
# or
serverless offline
```

This will start a local HTTP server on `http://localhost:3001` that emulates AWS Lambda and API Gateway locally. The MCP endpoint will be available at:
- `http://localhost:3001/mcp` (POST requests)
- `http://localhost:3001/mcp` (OPTIONS requests for CORS)

You can test the local server with curl:

**POST request (JSON response):**
```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Origin: http://localhost:3001" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

**POST request (SSE response):**
```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream, application/json" \
  -H "Origin: http://localhost:3001" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

**GET request (SSE stream):**
```bash
curl -X GET http://localhost:3001/mcp \
  -H "Accept: text/event-stream" \
  -H "Origin: http://localhost:3001"
```

### Testing

Run the test suites to verify MCP server functionality:

**Component tests:**
```bash
node simple-test.js
```

**Streamable HTTP transport tests:**
```bash
node test-streamable-http.js
```

**Legacy tests:**
```bash
node test-mcp.js
```

## MCP Protocol Compliance

This server implements the Model Context Protocol specification (2025-06-18) with **Streamable HTTP transport** and supports:

### **Streamable HTTP Transport**
- **POST Requests**: Send JSON-RPC messages to the server
- **GET Requests**: Open SSE streams for server-initiated messages
- **Server-Sent Events (SSE)**: Stream responses and notifications
- **Content Negotiation**: Supports both `application/json` and `text/event-stream`
- **Session Management**: Tracks connections with session IDs
- **Origin Validation**: Security protection against DNS rebinding attacks

### **MCP Features**
- **Tools**: Interactive functions that can be called by LLMs
- **Resources**: Static data sources that provide context
- **JSON-RPC 2.0**: Standard protocol for request/response communication
- **Error Handling**: Proper error responses for failed requests
- **CORS Support**: Cross-origin requests for web-based MCP clients

### **Transport Details**
The server provides a single MCP endpoint (`/mcp`) that supports:

1. **POST Method**: 
   - Accepts JSON-RPC requests, responses, and notifications
   - Returns either JSON responses or SSE streams based on `Accept` header
   - Validates `Origin` header for security

2. **GET Method**:
   - Opens SSE streams for server-initiated messages
   - Requires `Accept: text/event-stream` header
   - Returns 405 Method Not Allowed if SSE not supported

3. **OPTIONS Method**:
   - Handles CORS preflight requests
   - Returns appropriate CORS headers

## Data Model

The server accesses exercise data from MongoDB using the @baseplay/models ContentItems model with the following filters:

- `item_type: 'exercise'`: Only exercise content items
- `published_at: { $ne: null }`: Only published exercises

## Security Considerations

- The API is public by default. For production, configure authentication/authorization
- MongoDB connection string should be kept secure
- Consider rate limiting for production deployments
- Validate and sanitize all input parameters
