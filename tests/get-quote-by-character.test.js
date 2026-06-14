
const mockSend = jest.fn();
const mockDynamoDBClient = {
  send: mockSend
};

jest.doMock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({}))
}));

jest.doMock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBClient)
  },
  QueryCommand: jest.fn()
}));

describe('get-quote-by-character', () => {
  let lambdaHandler;
  
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-quotes-table';
    process.env.FAVORITES_TABLE_NAME = 'test-favorites-table';
    
    delete require.cache[require.resolve('../lambdas/get-quote-by-character/index.mjs')];
    
    return import('../lambdas/get-quote-by-character/index.mjs').then(module => {
      lambdaHandler = module.lambdaHandler;
    });
  });

  test('should return 400 error when character parameter is missing', async () => {
    const event = {
      pathParameters: {}
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Missing character parameter');
  });

  test('should return 404 error when character is not found', async () => {
    mockSend.mockResolvedValueOnce({
      Items: []
    });

    const event = {
      pathParameters: { character: 'UnknownCharacter' }
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Character not found: UnknownCharacter');
  });

  test('should return random quote for valid character', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          { quoteId: 'quote1', character: 'Arthur', text: 'Test quote 1' },
          { quoteId: 'quote2', character: 'Arthur', text: 'Test quote 2' }
        ]
      })
      .mockResolvedValueOnce({
        Count: 3
      });

    const event = {
      pathParameters: { character: 'Arthur' }
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('quoteId');
    expect(body).toHaveProperty('character', 'Arthur');
    expect(body).toHaveProperty('likes', 3);
  });

  test('should decode URL-encoded character name', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          { quoteId: 'quote1', character: 'Le Roi', text: 'Test quote' }
        ]
      })
      .mockResolvedValueOnce({
        Count: 1
      });

    const event = {
      pathParameters: { character: 'Le%20Roi' }
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.character).toBe('Le Roi');
  });

  test('should use cached data on subsequent calls for same character', async () => {
    // Reset cache first by making a fresh import
    jest.resetModules();
    const freshModule = await import('../lambdas/get-quote-by-character/index.mjs');
    
    mockSend
      .mockResolvedValueOnce({
        Items: [
          { quoteId: 'quote1', character: 'Arthur', text: 'Test quote' }
        ]
      })
      .mockResolvedValueOnce({ Count: 1 })
      .mockResolvedValueOnce({ Count: 2 });

    const event = {
      pathParameters: { character: 'Arthur' }
    };
    
    await freshModule.lambdaHandler(event);
    const result = await freshModule.lambdaHandler(event);

    expect(result.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  test('should handle character with no likes', async () => {
    // Reset cache first by making a fresh import
    jest.resetModules();
    const freshModule = await import('../lambdas/get-quote-by-character/index.mjs');
    
    mockSend
      .mockResolvedValueOnce({
        Items: [
          { quoteId: 'quote1', character: 'Arthur', text: 'Test quote' }
        ]
      })
      .mockResolvedValueOnce({
        Count: 0
      });

    const event = {
      pathParameters: { character: 'Arthur' }
    };
    const result = await freshModule.lambdaHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('likes', 0);
  });
});