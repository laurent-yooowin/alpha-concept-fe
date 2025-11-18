# Backend API Requirements

This document outlines the additional backend endpoints needed for the Activity Logs and Dashboard features.

## Activity Logs Endpoints

### GET /activity-logs
Get all activity logs (super_admin only)

**Query Parameters:**
- `userId` (optional): Filter logs by user ID

**Response:**
```json
[
  {
    "id": "string",
    "user_id": "string",
    "action": "string",
    "entity_type": "string",
    "entity_id": "string",
    "details": {},
    "created_at": "timestamp"
  }
]
```

## Dashboard Endpoints

### GET /dashboard/stats
Get overall dashboard statistics

**Response:**
```json
{
  "totalMissions": number,
  "pendingMissions": number,
  "completedMissions": number,
  "totalReports": number,
  "submittedReports": number,
  "validatedReports": number,
  "sentReports": number,
  "totalCoordinators": number,
  "avgProcessingTime": number (in days)
}
```

### GET /dashboard/monthly-missions
Get missions grouped by month (last 6 months)

**Response:**
```json
[
  {
    "month": "string (e.g., 'Jan 2024')",
    "count": number
  }
]
```

### GET /dashboard/coordinator-stats
Get top 5 coordinators by mission count

**Response:**
```json
[
  {
    "name": "string (coordinator full name)",
    "count": number (mission count)
  }
]
```

### GET /dashboard/status-breakdown
Get mission count grouped by status

**Response:**
```json
[
  {
    "status": "string (en_attente|planifiee|en_cours|terminee|refusee|annulee)",
    "count": number
  }
]
```

## Notes

1. All endpoints require JWT authentication via `Authorization: Bearer <token>` header
2. Activity logs endpoint should be restricted to super_admin role
3. Dashboard endpoints filter data by coordinator_id if user role is 'coordinator'
4. Dashboard endpoints show all data for admin and super_admin roles
5. Average processing time is calculated from report creation to validation time
