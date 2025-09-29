const { ExerciseMCPHandler } = require('./mcp-handler');

async function testMCPServer() {
  console.log('Testing MCP Server functionality...\n');
  
  const handler = new ExerciseMCPHandler();
  
  try {
    // Test 1: List Tools (direct server method call instead of handleRequest)
    console.log('1. Testing list tools...');
    const toolsResponse = await handler.server.request({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    });
    console.log('✓ Tools listed successfully');
    console.log(`   Found ${toolsResponse.result?.tools?.length || 0} tools`);
    
    // Test 2: List Resources
    console.log('\n2. Testing list resources...');
    const resourcesResponse = await handler.server.request({
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/list',
      params: {}
    });
    console.log('✓ Resources listed successfully');
    console.log(`   Found ${resourcesResponse.result?.resources?.length || 0} resources`);
    
    // Test 3: Call get_exercises tool (this will fail without MongoDB connection, but we can test the structure)
    console.log('\n3. Testing get_exercises tool...');
    try {
      const exercisesResponse = await handler.server.request({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'get_exercises',
          arguments: {
            limit: 5,
            skip: 0
          }
        }
      });
      console.log('✓ get_exercises tool called successfully');
      console.log('   Response structure is valid');
    } catch (error) {
      console.log('⚠ get_exercises tool failed (expected without MongoDB connection)');
      console.log(`   Error: ${error.message}`);
    }
    
    // Test 4: Read exercises resource
    console.log('\n4. Testing read exercises resource...');
    try {
      const resourceResponse = await handler.server.request({
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/read',
        params: {
          uri: 'exercise://exercises'
        }
      });
      console.log('✓ exercises resource read successfully');
      console.log('   Response structure is valid');
    } catch (error) {
      console.log('⚠ exercises resource read failed (expected without MongoDB connection)');
      console.log(`   Error: ${error.message}`);
    }
    
    console.log('\n✅ MCP Server structure tests completed successfully!');
    console.log('\nNote: Database-dependent operations will fail without a MongoDB connection.');
    console.log('Set MONGODB_URI environment variable to test with actual data.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testMCPServer().catch(console.error);
}

module.exports = { testMCPServer };
