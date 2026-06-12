import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export interface KaamelottStackProps extends cdk.StackProps {
  environment: 'staging' | 'prod';
}

export class KaamelottStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: KaamelottStackProps) {
    super(scope, id, props);

    const { environment } = props;
    const isProd = environment === 'prod';

    // S3 bucket — stores quotes.json, uploaded on every cdk deploy
    const bucket = new s3.Bucket(this, 'QuotesBucket', {
      bucketName: `kaamelott-quotes-${environment}-${this.account}`,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    new s3deploy.BucketDeployment(this, 'UploadQuotes', {
      sources: [s3deploy.Source.asset('./data')],
      destinationBucket: bucket,
    });

    // DynamoDB table — quoteId PK, character GSI
    const table = new dynamodb.Table(this, 'QuotesTable', {
      tableName: `kaamelott-quotes-${environment}`,
      partitionKey: { name: 'quoteId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'character-index',
      partitionKey: { name: 'character', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // DynamoDB table — favorites: quoteId PK, alias SK
    const favoritesTable = new dynamodb.Table(this, 'FavoritesTable', {
      tableName: `kaamelott-favorites-${environment}`,
      partitionKey: { name: 'quoteId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'alias', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    favoritesTable.addGlobalSecondaryIndex({
      indexName: 'alias-index',
      partitionKey: { name: 'alias', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const commonEnv = {
      TABLE_NAME: table.tableName,
      FAVORITES_TABLE_NAME: favoritesTable.tableName,
      ENVIRONMENT: environment,
    };

    const lambdaDefaults: Omit<lambda.FunctionProps, 'code' | 'handler'> = {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.X86_64,
      environment: commonEnv,
    };

    // Lambda: GET /quotes/random
    const getRandomQuote = new lambda.Function(this, 'GetRandomQuote', {
      ...lambdaDefaults,
      functionName: `kaamelott-get-random-quote-${environment}`,
      code: lambda.Code.fromAsset('lambdas/get-random-quote'),
      handler: 'index.lambdaHandler',
      timeout: cdk.Duration.seconds(5),
      description: 'Returns random Kaamelott quote(s) with optional batch size',
    });
    table.grantReadData(getRandomQuote);
    favoritesTable.grantReadData(getRandomQuote);

    // Lambda: GET /quotes/by-character/{character}
    const getQuoteByCharacter = new lambda.Function(this, 'GetQuoteByCharacter', {
      ...lambdaDefaults,
      functionName: `kaamelott-get-quote-by-character-${environment}`,
      code: lambda.Code.fromAsset('lambdas/get-quote-by-character'),
      handler: 'index.lambdaHandler',
      timeout: cdk.Duration.seconds(5),
      description: 'Returns a random Kaamelott quote filtered by character name',
    });
    table.grantReadData(getQuoteByCharacter);
    favoritesTable.grantReadData(getQuoteByCharacter);

    // Lambda: GET /quotes/by-favorites
    const getQuoteByFavorites = new lambda.Function(this, 'GetQuoteByFavorites', {
      ...lambdaDefaults,
      functionName: `kaamelott-get-quote-by-favorites-${environment}`,
      code: lambda.Code.fromAsset('lambdas/get-quote-by-favorites'),
      handler: 'index.lambdaHandler',
      timeout: cdk.Duration.seconds(5),
      description: 'Returns a random quote from user favorites with optional character filter',
    });
    table.grantReadData(getQuoteByFavorites);
    favoritesTable.grantReadData(getQuoteByFavorites);

    // Lambda: POST /favorites
    const postFavorite = new lambda.Function(this, 'PostFavorite', {
      ...lambdaDefaults,
      functionName: `kaamelott-post-favorite-${environment}`,
      code: lambda.Code.fromAsset('lambdas/post-favorite'),
      handler: 'index.lambdaHandler',
      timeout: cdk.Duration.seconds(5),
      description: 'Like or unlike a quote for a given alias',
    });
    favoritesTable.grantReadWriteData(postFavorite);

    // Lambda: GET /favorites/status
    const getFavoriteStatus = new lambda.Function(this, 'GetFavoriteStatus', {
      ...lambdaDefaults,
      functionName: `kaamelott-get-favorite-status-${environment}`,
      code: lambda.Code.fromAsset('lambdas/get-favorite-status'),
      handler: 'index.lambdaHandler',
      timeout: cdk.Duration.seconds(5),
      description: 'Returns whether a quote is liked by a given alias',
    });
    favoritesTable.grantReadData(getFavoriteStatus);

    // Lambda: GET /characters
    const getCharacters = new lambda.Function(this, 'GetCharacters', {
      ...lambdaDefaults,
      functionName: `kaamelott-get-characters-${environment}`,
      code: lambda.Code.fromAsset('lambdas/get-characters'),
      handler: 'index.lambdaHandler',
      timeout: cdk.Duration.seconds(10),
      description: 'Returns the sorted list of characters present in DynamoDB',
    });
    table.grantReadData(getCharacters);

    // Lambda: admin loader (no API route)
    const loadQuotes = new lambda.Function(this, 'LoadQuotes', {
      ...lambdaDefaults,
      functionName: `kaamelott-load-quotes-${environment}`,
      code: lambda.Code.fromAsset('lambdas/load-quotes'),
      handler: 'index.lambdaHandler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        ...commonEnv,
        BUCKET_NAME: bucket.bucketName,
      },
      description: 'One-time loader: reads quotes.json from S3 and batch-writes to DynamoDB',
    });
    table.grantWriteData(loadQuotes);
    bucket.grantRead(loadQuotes);

    // API Gateway
    const apiLogGroup = new logs.LogGroup(this, 'ApiAccessLogs', {
      logGroupName: `/aws/apigateway/kaamelott-${environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const api = new apigateway.RestApi(this, 'KaamelottApi', {
      restApiName: `kaamelott-api-${environment}`,
      deployOptions: {
        stageName: environment,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST'],
      },
    });

    const quotes = api.root.addResource('quotes');
    
    // /quotes/random
    const randomResource = quotes.addResource('random');
    randomResource.addMethod('GET', new apigateway.LambdaIntegration(getRandomQuote), {
      apiKeyRequired: true,
    });
    
    // /quotes/by-character/{character}
    const byCharacterResource = quotes.addResource('by-character');
    const characterResource = byCharacterResource.addResource('{character}');
    characterResource.addMethod('GET', new apigateway.LambdaIntegration(getQuoteByCharacter), {
      apiKeyRequired: true,
    });
    
    // /quotes/by-favorites
    const byFavoritesResource = quotes.addResource('by-favorites');
    byFavoritesResource.addMethod('GET', new apigateway.LambdaIntegration(getQuoteByFavorites), {
      apiKeyRequired: true,
    });

    const favorites = api.root.addResource('favorites');
    favorites.addMethod('POST', new apigateway.LambdaIntegration(postFavorite), {
      apiKeyRequired: true,
    });
    
    // /favorites/status
    const favoritesStatusResource = favorites.addResource('status');
    favoritesStatusResource.addMethod('GET', new apigateway.LambdaIntegration(getFavoriteStatus), {
      apiKeyRequired: true,
    });

    const characters = api.root.addResource('characters');
    characters.addMethod('GET', new apigateway.LambdaIntegration(getCharacters), {
      apiKeyRequired: true,
    });

    // API Documentation
    new apigateway.CfnDocumentationPart(this, 'ApiDescription', {
      restApiId: api.restApiId,
      location: { type: 'API' },
      properties: JSON.stringify({
        info: {
          title: 'Kaamelott Quotes API',
          version: '2.0.0',
          description: 'API for retrieving Kaamelott quotes with features for random quotes, character filtering, and user favorites management.'
        }
      })
    });

    // /quotes/random documentation
    new apigateway.CfnDocumentationPart(this, 'QuotesRandomDoc', {
      restApiId: api.restApiId,
      location: {
        type: 'METHOD',
        method: 'GET',
        path: '/quotes/random'
      },
      properties: JSON.stringify({
        summary: 'Get random quote(s)',
        description: 'Returns one or more random Kaamelott quotes. Use batchSize parameter to get multiple quotes in a single request.',
        parameters: {
          batchSize: {
            description: 'Number of quotes to return (1-20, default: 1)',
            type: 'integer',
            minimum: 1,
            maximum: 20,
            required: false
          }
        },
        responses: {
          '200': {
            description: 'Successful response',
            examples: {
              'Single quote': {
                quoteId: '7XLMZGpC',
                character: 'Alzagar',
                text: 'Alors, je vais être honnête avec vous...',
                actor: 'Guillaume Gallienne',
                film: 'Kaamelott premier volet (2021)',
                likes: 5
              },
              'Multiple quotes': {
                quotes: [
                  {
                    quoteId: '7XLMZGpC',
                    character: 'Alzagar',
                    text: 'Alors, je vais être honnête avec vous...',
                    likes: 5
                  }
                ]
              }
            }
          },
          '400': {
            description: 'Invalid batchSize parameter'
          }
        }
      })
    });

    // /quotes/by-character/{character} documentation
    new apigateway.CfnDocumentationPart(this, 'QuotesByCharacterDoc', {
      restApiId: api.restApiId,
      location: {
        type: 'METHOD',
        method: 'GET',
        path: '/quotes/by-character/{character}'
      },
      properties: JSON.stringify({
        summary: 'Get random quote by character',
        description: 'Returns a random quote from the specified character.',
        parameters: {
          character: {
            description: 'Character name (URL encoded if necessary)',
            type: 'string',
            required: true,
            location: 'path'
          }
        },
        responses: {
          '200': {
            description: 'Random quote from the specified character'
          },
          '404': {
            description: 'Character not found'
          }
        }
      })
    });

    // /quotes/by-favorites documentation
    new apigateway.CfnDocumentationPart(this, 'QuotesByFavoritesDoc', {
      restApiId: api.restApiId,
      location: {
        type: 'METHOD',
        method: 'GET',
        path: '/quotes/by-favorites'
      },
      properties: JSON.stringify({
        summary: 'Get random quote from user favorites',
        description: 'Returns a random quote from user\'s favorites, optionally filtered by character.',
        parameters: {
          alias: {
            description: 'User identifier',
            type: 'string',
            required: true
          },
          character: {
            description: 'Filter favorites by character name (optional)',
            type: 'string',
            required: false
          }
        },
        responses: {
          '200': {
            description: 'Random quote from user favorites'
          },
          '400': {
            description: 'Missing alias parameter'
          },
          '404': {
            description: 'No favorites found for user or character filter'
          }
        }
      })
    });

    // POST /favorites documentation
    new apigateway.CfnDocumentationPart(this, 'PostFavoritesDoc', {
      restApiId: api.restApiId,
      location: {
        type: 'METHOD',
        method: 'POST',
        path: '/favorites'
      },
      properties: JSON.stringify({
        summary: 'Add or remove favorite',
        description: 'Add or remove a quote from user\'s favorites.',
        requestBody: {
          description: 'Favorite operation details',
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['quoteId', 'alias', 'favorite'],
                properties: {
                  quoteId: {
                    type: 'string',
                    description: 'Quote identifier'
                  },
                  alias: {
                    type: 'string',
                    description: 'User identifier'
                  },
                  favorite: {
                    type: 'boolean',
                    description: 'true to add, false to remove'
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Favorite updated successfully',
            example: {
              quoteId: '7XLMZGpC',
              alias: 'john_doe',
              totalLikes: 6
            }
          },
          '400': {
            description: 'Invalid request body'
          }
        }
      })
    });

    // GET /favorites/status documentation
    new apigateway.CfnDocumentationPart(this, 'FavoritesStatusDoc', {
      restApiId: api.restApiId,
      location: {
        type: 'METHOD',
        method: 'GET',
        path: '/favorites/status'
      },
      properties: JSON.stringify({
        summary: 'Check favorite status',
        description: 'Check if a specific quote is favorited by a user.',
        parameters: {
          quoteId: {
            description: 'Quote identifier',
            type: 'string',
            required: true
          },
          alias: {
            description: 'User identifier',
            type: 'string',
            required: true
          }
        },
        responses: {
          '200': {
            description: 'Favorite status',
            example: {
              quoteId: '7XLMZGpC',
              alias: 'john_doe',
              liked: true
            }
          },
          '400': {
            description: 'Missing required parameters'
          }
        }
      })
    });

    // GET /characters documentation
    new apigateway.CfnDocumentationPart(this, 'CharactersDoc', {
      restApiId: api.restApiId,
      location: {
        type: 'METHOD',
        method: 'GET',
        path: '/characters'
      },
      properties: JSON.stringify({
        summary: 'Get all characters',
        description: 'Returns a sorted list of all available characters.',
        responses: {
          '200': {
            description: 'List of characters',
            example: {
              characters: ['Alzagar', 'Angharad', 'Arthur', 'Lancelot']
            }
          }
        }
      })
    });

    // Create documentation version
    new apigateway.CfnDocumentationVersion(this, 'ApiDocsVersion', {
      restApiId: api.restApiId,
      documentationVersion: '2.0.0',
      description: 'Kaamelott Quotes API v2.0.0 - RESTful endpoints with batch support and favorites',
    });

    const apiKey = new apigateway.ApiKey(this, 'ApiKey', {
      apiKeyName: `kaamelott-${environment}`,
      description: `API key for kaamelott-${environment}`,
    });

    const usagePlan = new apigateway.UsagePlan(this, 'UsagePlan', {
      name: `kaamelott-usage-plan-${environment}`,
      apiStages: [{ api, stage: api.deploymentStage }],
      quota: {
        limit: 1000,
        period: apigateway.Period.DAY,
      },
    });
    usagePlan.addApiKey(apiKey);

    // Outputs
    new cdk.CfnOutput(this, 'ApiKeyId', {
      value: apiKey.keyId,
      description: 'Look up key value: aws apigateway get-api-key --api-key <id> --include-value --region ap-southeast-1 --query value --output text',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: `${api.url}quotes/random`,
      description: 'Base API URL for random quotes - use /quotes/by-character/{character} for character filtering',
    });
    new cdk.CfnOutput(this, 'LoadQuotesFunctionName', {
      value: loadQuotes.functionName,
      description: 'Invoke once per environment to populate DynamoDB: aws lambda invoke --function-name <value> --region ap-southeast-1 /tmp/out.json',
    });
    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
    });
    new cdk.CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
    });
  }
}
