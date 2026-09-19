# User Registration Guide for Delicate Couriers

## Platform Access

**URL:** [https://app2.delicatecourier.co.za](https://app2.delicatecourier.co.za)

## Invite Codes

### Available Invite Codes

| Role             | Invite Code   | Description                                                                            |
| ---------------- | ------------- | -------------------------------------------------------------------------------------- |
| **Regular User** | `DC-USER789`  | Basic user with limited access - can create and track deliveries                       |
| **Admin User**   | `DC-ADMIN123` | Administrator with full tenant access - can manage users and all deliveries            |
| **Super Admin**  | `DC-SUPER456` | Super administrator with full platform access - can manage tenants and system settings |

### Code Format

All invite codes follow this format:

- Prefix: `DC-`
- Length: 10 characters total (DC- + 7 characters)
- Characters: Uppercase letters and numbers only

## Registration Instructions

### Step-by-Step Registration

1. **Navigate to the Registration Page**

   ```
   https://app2.delicatecourier.co.za/register
   ```

2. **Fill in the Registration Form**

   | Field       | Required | Instructions                                |
   | ----------- | -------- | ------------------------------------------- |
   | Full Name   | Yes      | Enter your full name                        |
   | Email       | Yes      | Enter a valid email address                 |
   | Password    | Yes      | Minimum 6 characters                        |
   | Invite Code | Yes      | Enter one of the codes from the table above |

3. **Submit the Form**
   - Click the "Register" button
   - The system will automatically assign the correct role based on your invite code
   - You'll be redirected to the login page upon successful registration

4. **Login**
   - Navigate to [https://app2.delicatecourier.co.za/login](https://app2.delicatecourier.co.za/login)
   - Use your email and password to log in
   - You'll be granted access based on your assigned role

### Example Registration

**For a Regular User:**

```
Full Name: John Doe
Email: john.doe@example.com
Password: SecurePassword123
Invite Code: DC-USER789
```

**For an Admin User:**

```
Full Name: Jane Smith
Email: jane.smith@company.com
Password: SecurePassword123
Invite Code: DC-ADMIN123
```

**For a Super Admin:**

```
Full Name: Admin User
Email: admin@delicatecouriers.com
Password: SecurePassword123
Invite Code: DC-SUPER456
```

## API Registration (For Developers)

### Endpoint

```
POST https://app2.delicatecourier.co.za/api/auth/register
```

### Request Body

```json
{
  "name": "string",
  "email": "string",
  "password": "string",
  "inviteCode": "string"
}
```

### Response

**Success (200 OK)**

```json
{
  "token": "jwt-token-here",
  "userId": 123,
  "email": "user@example.com",
  "name": "User Name",
  "role": "User",
  "tenantID": 1
}
```

**Error (400 Bad Request)**

```json
{
  "message": "Invalid invite code"
}
```

## Testing Codes

You can test if an invite code is valid using the validate endpoint:

### Validate Endpoint

```
POST https://app2.delicatecourier.co.za/api/invitecodes/validate
```

**Request:**

```json
{
  "code": "DC-USER789"
}
```

**Response:**

```json
{
  "isValid": true,
  "role": "User",
  "message": "Valid invite code"
}
```

## Troubleshooting

### Common Issues

| Issue                                 | Solution                                                              |
| ------------------------------------- | --------------------------------------------------------------------- |
| "Invalid invite code"                 | Check that you've entered the code exactly as shown (case-sensitive)  |
| "User with this email already exists" | Use a different email or try to log in instead                        |
| Password too short                    | Password must be at least 6 characters                                |
| Registration success but can't login  | Wait a few seconds and try again, or use the "Forgot Password" option |
| Can't access the site                 | Ensure you're using https://app2.delicatecourier.co.za                |

### Quick Checklist

- [ ] Invite code starts with "DC-"
- [ ] All characters are uppercase
- [ ] Email format is correct (name@domain.com)
- [ ] Password is at least 6 characters
- [ ] All fields are filled out
- [ ] Using correct URL: https://app2.delicatecourier.co.za

## Support

For issues with registration:

- **Email:** support@delicatecourier.co.za
- **Platform:** https://app2.delicatecourier.co.za
- **Documentation:** https://app2.delicatecourier.co.za/docs

---

_Last Updated: February 14, 2026_
