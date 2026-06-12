# Kaamelott Quotes API Documentation

## Overview
This API provides access to Kaamelott quotes with features for retrieving random quotes, filtering by character, and managing user favorites.

**Base URL**: `https://api-gateway-url.amazonaws.com/staging/`

**Authentication**: All endpoints require an API key passed in the `x-api-key` header.

## Endpoints

### 1. Get Random Quote(s)
**Endpoint**: `GET /quotes/random`

Returns one or more random quotes from the database.

**Query Parameters**:
- `batchSize` (optional): Number of quotes to return (1-20, default: 1)

**Response Format**:
- Single quote (batchSize=1): Quote object
- Multiple quotes (batchSize>1): `{ "quotes": [quote1, quote2, ...] }`

**Examples**:

```bash
# Get single random quote
curl -H "x-api-key: YOUR_API_KEY" \
  "https://api-gateway-url.amazonaws.com/staging/quotes/random"

# Get 5 random quotes
curl -H "x-api-key: YOUR_API_KEY" \
  "https://api-gateway-url.amazonaws.com/staging/quotes/random?batchSize=5"
```

**Response Examples**:

Single quote:
```json
{
  "quoteId": "7XLMZGpC",
  "character": "Alzagar",
  "text": "Alors, je vais être honnête avec vous...",
  "actor": "Guillaume Gallienne",
  "film": "Kaamelott premier volet (2021)",
  "season": null,
  "episode": null,
  "likes": 5
}
```

Multiple quotes:
```json
{
  "quotes": [
    {
      "quoteId": "7XLMZGpC",
      "character": "Alzagar",
      "text": "Alors, je vais être honnête avec vous...",
      "actor": "Guillaume Gallienne",
      "film": "Kaamelott premier volet (2021)",
      "season": null,
      "episode": null,
      "likes": 5
    },
    {
      "quoteId": "CdEK6uph",
      "character": "Angharad",
      "text": "Hé ben, si un jour j'oublie que je suis boniche...",
      "actor": "Vanessa Guedj",
      "film": "Kaamelott",
      "season": "Livre I",
      "episode": "La Romance de Lancelot",
      "likes": 2
    }
  ]
}
```

### 2. Get Quote by Character
**Endpoint**: `GET /quotes/by-character/{character}`

Returns a random quote from the specified character.

**Path Parameters**:
- `character`: The character name (URL encoded if necessary)

**Examples**:

```bash
# Get random quote from Arthur
curl -H "x-api-key: YOUR_API_KEY" \
  "https://api-gateway-url.amazonaws.com/staging/quotes/by-character/Arthur"

# Get random quote from Le Roi Burgonde (URL encoded)
curl -H "x-api-key: YOUR_API_KEY" \
  "https://api-gateway-url.amazonaws.com/staging/quotes/by-character/Le%20Roi%20Burgonde"
```

**Response**: Same format as single random quote.

### 3. Get Quote from User Favorites
**Endpoint**: `GET /quotes/by-favorites`

Returns a random quote from a user's favorites, optionally filtered by character.

**Query Parameters**:
- `alias` (required): User identifier
- `character` (optional): Filter favorites by character

**Examples**:

```bash
# Get random quote from user's favorites
curl -H "x-api-key: YOUR_API_KEY" \
  "https://api-gateway-url.amazonaws.com/staging/quotes/by-favorites?alias=john_doe"

# Get random Arthur quote from user's favorites
curl -H "x-api-key: YOUR_API_KEY" \
  "https://api-gateway-url.amazonaws.com/staging/quotes/by-favorites?alias=john_doe&character=Arthur"
```

**Response**: Same format as single random quote.

**Error Responses**:
- `404`: No favorites found for the alias
- `404`: No favorites found matching the character filter

### 4. Manage Favorites
**Endpoint**: `POST /favorites`

Add or remove a quote from user's favorites.

**Request Body**:
```json
{
  "quoteId": "7XLMZGpC",
  "alias": "john_doe",
  "favorite": true
}
```

**Fields**:
- `quoteId` (required): The quote identifier
- `alias` (required): User identifier
- `favorite` (required): `true` to add, `false` to remove

**Example**:

```bash
curl -X POST \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"quoteId":"7XLMZGpC","alias":"john_doe","favorite":true}' \
  "https://api-gateway-url.amazonaws.com/staging/favorites"
```

**Response**:
```json
{
  "quoteId": "7XLMZGpC",
  "alias": "john_doe",
  "totalLikes": 6
}
```

### 5. Check Favorite Status
**Endpoint**: `GET /favorites/status`

Check if a specific quote is favorited by a user.

**Query Parameters**:
- `quoteId` (required): The quote identifier
- `alias` (required): User identifier

**Example**:

```bash
curl -H "x-api-key: YOUR_API_KEY" \
  "https://api-gateway-url.amazonaws.com/staging/favorites/status?quoteId=7XLMZGpC&alias=john_doe"
```

**Response**:
```json
{
  "quoteId": "7XLMZGpC",
  "alias": "john_doe",
  "liked": true
}
```

### 6. Get Characters
**Endpoint**: `GET /characters`

Returns a sorted list of all available characters.

**Example**:

```bash
curl -H "x-api-key: YOUR_API_KEY" \
  "https://api-gateway-url.amazonaws.com/staging/characters"
```

**Response**:
```json
{
  "characters": [
    "Alzagar",
    "Angharad", 
    "Arthur",
    "Lancelot",
    "..."
  ]
}
```

## Quote Object Structure

All quote responses include the following fields:

```json
{
  "quoteId": "string",      // Unique identifier
  "character": "string",    // Character name
  "text": "string",         // Quote text
  "actor": "string",        // Actor name
  "film": "string",         // Film/series name
  "season": "string|null",  // Season (if applicable)
  "episode": "string|null", // Episode (if applicable)
  "likes": "number"         // Total likes count
}
```

## Error Responses

All error responses follow this format:

```json
{
  "error": "Error message description"
}
```

**Common HTTP Status Codes**:
- `200`: Success
- `400`: Bad Request (missing/invalid parameters)
- `401`: Unauthorized (missing/invalid API key)
- `404`: Not Found (resource not found)
- `429`: Too Many Requests (rate limit exceeded)
- `500`: Internal Server Error

## Rate Limits

- **Daily Limit**: 1,000 requests per API key
- **Concurrent Requests**: Standard AWS API Gateway limits apply

## Migration from Previous API

### Breaking Changes
The API structure has been updated for better RESTful design:

**Old → New Endpoints**:
- `GET /quotes` → `GET /quotes/random`
- `GET /quotes/{character}` → `GET /quotes/by-character/{character}`
- `GET /favorites` → `GET /favorites/status`

**New Features**:
- `GET /quotes/random?batchSize=N` - Batch quote retrieval
- `GET /quotes/by-favorites?alias=X&character=Y` - User favorites

### Backwards Compatibility
The old endpoints are **not supported**. Please update your integrations to use the new endpoint structure.

## Support

For API support or feature requests, please contact the development team or create an issue in the project repository.