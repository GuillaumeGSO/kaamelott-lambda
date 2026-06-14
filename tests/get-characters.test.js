
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
  ScanCommand: jest.fn()
}));

describe('get-characters', () => {
  let lambdaHandler;
  
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-quotes-table';
    
    return import('../lambdas/get-characters/index.mjs').then(module => {
      lambdaHandler = module.lambdaHandler;
    });
  });

  test('should return sorted characters with quote counts', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { character: 'Arthur' },
        { character: 'Lancelot' },
        { character: 'Arthur' },
        { character: 'Perceval' }
      ],
      LastEvaluatedKey: null
    });

    const result = await lambdaHandler();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveLength(3);
    expect(body[0]).toEqual({ character: 'Arthur', numberOfQuotes: 2 });
    expect(body[1]).toEqual({ character: 'Lancelot', numberOfQuotes: 1 });
    expect(body[2]).toEqual({ character: 'Perceval', numberOfQuotes: 1 });
  });

  test('should handle pagination correctly', async () => {
    // Reset the cache first by making a fresh import
    jest.resetModules();
    const freshModule = await import('../lambdas/get-characters/index.mjs');
    
    mockSend
      .mockResolvedValueOnce({
        Items: [
          { character: 'Arthur' },
          { character: 'Lancelot' }
        ],
        LastEvaluatedKey: { character: 'Lancelot' }
      })
      .mockResolvedValueOnce({
        Items: [
          { character: 'Arthur' },
          { character: 'Perceval' }
        ],
        LastEvaluatedKey: null
      });

    const result = await freshModule.lambdaHandler();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveLength(3);
    expect(body[0]).toEqual({ character: 'Arthur', numberOfQuotes: 2 });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('should return cached result on subsequent calls', async () => {
    // Reset the cache first by making a fresh import
    jest.resetModules();
    const freshModule = await import('../lambdas/get-characters/index.mjs');
    
    mockSend.mockResolvedValueOnce({
      Items: [{ character: 'Arthur' }],
      LastEvaluatedKey: null
    });

    await freshModule.lambdaHandler();
    const result = await freshModule.lambdaHandler();

    expect(result.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('should handle empty table', async () => {
    // Reset the cache first by making a fresh import
    jest.resetModules();
    const freshModule = await import('../lambdas/get-characters/index.mjs');
    
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: null
    });

    const result = await freshModule.lambdaHandler();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual([]);
  });
});