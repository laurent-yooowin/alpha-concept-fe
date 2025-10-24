# Report Email Validation Fix

## Problem

When sending a report from the visit page, the following error occurred:

```
ERROR  Error creating report: ["recipientEmail must be an email"]
```

**Error Location:**
```typescript
// app/(tabs)/visite.tsx:467
console.error('Error creating visit:', visitResponse.error);
```

## Root Cause

The issue was in the report creation logic where `mission?.client` was being used as the `recipientEmail`:

```typescript
// ❌ WRONG - client is a company name, not an email
recipientEmail: mission?.client || undefined,
```

### Why This Failed

1. **Mission Structure:**
   - `mission.client` = Company name (e.g., "Acme Corporation")
   - `mission.contactEmail` = Contact email (e.g., "contact@acme.com")

2. **Backend Validation:**
   ```typescript
   // backend/src/reports/report.dto.ts
   @IsOptional()
   @IsEmail()  // ← Validates email format
   recipientEmail?: string;
   ```

3. **Validation Error:**
   - Backend received: `recipientEmail: "Acme Corporation"`
   - Validator rejected: Not a valid email format
   - Error returned: `["recipientEmail must be an email"]`

## Solution

Changed `mission?.client` to `mission?.contactEmail`:

```typescript
// ✅ CORRECT - contactEmail contains the actual email address
recipientEmail: mission?.contactEmail || undefined,
```

## Mission Entity Structure

The Mission entity has two separate fields:

```typescript
@Column()
client: string;  // Company name (e.g., "Acme Corporation")

@Column({ length: 255, nullable: true })
contactEmail: string;  // Email address (e.g., "contact@acme.com")
```

### Complete Contact Information Fields

```typescript
{
  client: string;              // Company/Client name
  contactFirstName: string;    // Contact person's first name
  contactLastName: string;     // Contact person's last name
  contactEmail: string;        // Contact email address ✅
  contactPhone: string;        // Contact phone number
}
```

## Implementation Details

### Before (Incorrect)

```typescript
const reportResponse = await reportService.createReport({
  missionId: mission?.id?.toString() || '',
  visitId: visitResponse.data?.id,
  title: `RAPPORT VISITE - ${mission?.title}`,
  content: reportContent,
  status: 'envoye',
  conformityPercentage: conformity,
  recipientEmail: mission?.client || undefined,  // ❌ Company name
});
```

### After (Correct)

```typescript
const reportResponse = await reportService.createReport({
  missionId: mission?.id?.toString() || '',
  visitId: visitResponse.data?.id,
  title: `RAPPORT VISITE - ${mission?.title}`,
  content: reportContent,
  status: 'envoye',
  conformityPercentage: conformity,
  recipientEmail: mission?.contactEmail || undefined,  // ✅ Email address
});
```

## Backend Validation

The backend validates email format using `class-validator`:

```typescript
// backend/src/reports/report.dto.ts
export class CreateReportDto {
  @IsUUID()
  missionId: string;

  @IsOptional()
  @IsUUID()
  visitId?: string;

  @IsString()
  title: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @IsOptional()
  @IsNumber()
  conformityPercentage?: number;

  @IsOptional()
  @IsEmail()  // ← Validates email format
  recipientEmail?: string;
}
```

### Email Validation Rules

The `@IsEmail()` decorator validates:
- ✅ Valid format: `user@domain.com`
- ✅ Valid format: `contact@example.co.uk`
- ✅ Valid format: `info@subdomain.example.com`
- ❌ Invalid: `Company Name`
- ❌ Invalid: `not-an-email`
- ❌ Invalid: `missing@domain`

## Testing

### Test Cases

**1. Mission with Contact Email:**
```typescript
mission = {
  id: "123",
  client: "Acme Corporation",
  contactEmail: "contact@acme.com"
}

// Result: ✅ Report created successfully
recipientEmail: "contact@acme.com"
```

**2. Mission without Contact Email:**
```typescript
mission = {
  id: "123",
  client: "Acme Corporation",
  contactEmail: null
}

// Result: ✅ Report created (recipientEmail is optional)
recipientEmail: undefined
```

**3. Previous Behavior (Wrong):**
```typescript
mission = {
  id: "123",
  client: "Acme Corporation"
}

// Result: ❌ Validation error
recipientEmail: "Acme Corporation"  // Not a valid email!
```

## Example Report Creation

```typescript
// Create a report with proper email
const report = await reportService.createReport({
  missionId: "abc-123",
  visitId: "def-456",
  title: "RAPPORT VISITE - Construction Site",
  content: "Detailed report content...",
  status: "envoye",
  conformityPercentage: 92,
  recipientEmail: "contact@client.com"  // ✅ Valid email
});
```

## Error Handling

The visit page handles report creation errors:

```typescript
if (reportResponse.error) {
  console.error('Error creating report:', reportResponse.error);
  Alert.alert('Erreur', 'Impossible de sauvegarder le rapport sur le serveur');
  return;
}
```

### Common Errors

**1. Invalid Email Format:**
```json
{
  "statusCode": 400,
  "message": ["recipientEmail must be an email"],
  "error": "Bad Request"
}
```
**Solution:** Ensure using `contactEmail`, not `client`

**2. Missing Required Fields:**
```json
{
  "statusCode": 400,
  "message": ["title must be a string", "content must be a string"],
  "error": "Bad Request"
}
```
**Solution:** Ensure all required fields are provided

**3. Invalid UUID:**
```json
{
  "statusCode": 400,
  "message": ["missionId must be a UUID"],
  "error": "Bad Request"
}
```
**Solution:** Use valid mission ID

## Files Modified

1. ✅ `/app/(tabs)/visite.tsx`
   - Changed `recipientEmail` from `mission?.client` to `mission?.contactEmail`
   - Line 478

## Related Files

- `/backend/src/reports/report.dto.ts` - Report validation rules
- `/backend/src/missions/mission.entity.ts` - Mission entity structure
- `/services/missionService.ts` - Mission type definitions
- `/services/reportService.ts` - Report service API calls

## Key Takeaways

**✅ DO:**
- Use `mission.contactEmail` for email addresses
- Use `mission.client` for company/client name
- Validate email format before sending to backend
- Handle optional fields with `|| undefined`

**❌ DON'T:**
- Use `mission.client` as an email address
- Assume company names are email addresses
- Send unvalidated data to backend
- Ignore validation errors

## Summary

The report email validation error was caused by passing a company name (`mission.client`) instead of an email address (`mission.contactEmail`) to the `recipientEmail` field. The backend's email validation decorator correctly rejected the invalid format.

**The fix:**
- ✅ Changed from `mission?.client` to `mission?.contactEmail`
- ✅ Backend validation now passes
- ✅ Reports can be created successfully
- ✅ Maintains proper separation between company name and contact email

**Reports can now be sent successfully from the visit page!** 📧✅
