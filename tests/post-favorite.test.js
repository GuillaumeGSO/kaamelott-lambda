
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
  PutCommand: jest.fn(),
  DeleteCommand: jest.fn(),
  QueryCommand: jest.fn(),
  GetCommand: jest.fn()
}));

describe('post-favorite', () => {
  let lambdaHandler;
  
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FAVORITES_TABLE_NAME = 'test-favorites-table';
    
    delete require.cache[require.resolve('../lambdas/post-favorite/index.mjs')];
    
    return import('../lambdas/post-favorite/index.mjs').then(module => {
      lambdaHandler = module.lambdaHandler;
    });
  });

  test('should return 400 error when body is invalid JSON', async () => {
    const event = {
      body: 'invalid json'
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Invalid JSON body');
  });

  test('should return 400 error when quoteId is missing', async () => {
    const event = {
      body: JSON.stringify({ favorite: true, alias: 'testuser' })
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Missing required field: quoteId');
  });

  test('should return 400 error when favorite is not boolean', async () => {
    const event = {
      body: JSON.stringify({ quoteId: 'quote1', favorite: 'yes', alias: 'testuser' })
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Missing required field: favorite (boolean)');
  });

  test('should return 400 error when alias is missing', async () => {
    const event = {
      body: JSON.stringify({ quoteId: 'quote1', favorite: true })
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Missing required field: alias');
  });

  test('should return 400 error when alias is empty string', async () => {
    const event = {
      body: JSON.stringify({ quoteId: 'quote1', favorite: true, alias: '   ' })
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Missing required field: alias');
  });

  test('should add favorite when favorite is true', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { quoteId: 'quote1' } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Count: 3 });

    const event = {
      body: JSON.stringify({ quoteId: 'quote1', favorite: true, alias: 'testuser' })
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual({
      quoteId: 'quote1',
      alias: 'testuser',
      likes: 3
    });
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  test('should remove favorite when favorite is false', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { quoteId: 'quote1' } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Count: 2 });

    const event = {
      body: JSON.stringify({ quoteId: 'quote1', favorite: false, alias: 'testuser' })
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual({
      quoteId: 'quote1',
      alias: 'testuser',
      likes: 2
    });
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  test('should handle empty body gracefully', async () => {
    const event = {};
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Missing required field: quoteId');
  });

  test('should handle quote with zero likes', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { quoteId: 'quote1' } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Count: 0 });

    const event = {
      body: JSON.stringify({ quoteId: 'quote1', favorite: true, alias: 'testuser' })
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.likes).toBe(0);
  });

  test('should trim alias whitespace', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { quoteId: 'quote1' } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Count: 1 });

    const event = {
      body: JSON.stringify({ quoteId: 'quote1', favorite: true, alias: '  testuser  ' })
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.alias).toBe('testuser');
  });
});