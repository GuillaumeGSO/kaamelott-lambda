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

describe('get-likes', () => {
  let lambdaHandler;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.FAVORITES_TABLE_NAME = 'test-favorites-table';

    ({ lambdaHandler } = await import('../lambdas/get-likes/index.mjs'));
  });

  test('should count likes per quote', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ quoteId: 'quote1' }, { quoteId: 'quote2' }, { quoteId: 'quote1' }]
    });

    const result = await lambdaHandler();

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ likes: { quote1: 2, quote2: 1 } });
  });

  test('should return an empty map when nothing is liked', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await lambdaHandler();

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ likes: {} });
  });

  test('should follow pagination', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [{ quoteId: 'quote1' }], LastEvaluatedKey: { quoteId: 'quote1' } })
      .mockResolvedValueOnce({ Items: [{ quoteId: 'quote1' }] });

    const result = await lambdaHandler();

    expect(JSON.parse(result.body)).toEqual({ likes: { quote1: 2 } });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
