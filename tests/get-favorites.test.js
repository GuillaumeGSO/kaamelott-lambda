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

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');

describe('get-favorites', () => {
  let lambdaHandler;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.FAVORITES_TABLE_NAME = 'test-favorites-table';

    ({ lambdaHandler } = await import('../lambdas/get-favorites/index.mjs'));
  });

  test('should return 400 when alias is missing', async () => {
    const result = await lambdaHandler({ queryStringParameters: null });

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('alias');
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('should return 400 when alias is blank', async () => {
    const result = await lambdaHandler({ queryStringParameters: { alias: '   ' } });

    expect(result.statusCode).toBe(400);
  });

  test('should return 400 when alias is too long', async () => {
    const result = await lambdaHandler({ queryStringParameters: { alias: 'x'.repeat(21) } });

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('at most 20');
  });

  test('should return the quoteIds liked by the alias', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ quoteId: 'quote1' }, { quoteId: 'quote2' }] });

    const result = await lambdaHandler({ queryStringParameters: { alias: ' testuser ' } });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ alias: 'testuser', quoteIds: ['quote1', 'quote2'] });
    expect(QueryCommand).toHaveBeenCalledWith(expect.objectContaining({
      IndexName: 'alias-index',
      ExpressionAttributeValues: { ':alias': 'testuser' }
    }));
  });

  test('should return an empty list, not a 404, when the alias has no likes', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await lambdaHandler({ queryStringParameters: { alias: 'nobody' } });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ alias: 'nobody', quoteIds: [] });
  });
});
