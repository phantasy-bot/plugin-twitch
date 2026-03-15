# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x.x   | :white_check_mark: |
| < 2.0   | :x:                |

## Reporting a Vulnerability

We take the security of Phantasy Agent seriously. If you believe you have found a security vulnerability, please report it to us responsibly.

### Please do NOT:
- Open a public issue on GitHub
- Disclose the vulnerability publicly before it has been addressed
- Exploit the vulnerability beyond proof-of-concept

### Please DO:
- Email your findings to **security@phantasy.bot**
- Include detailed steps to reproduce the vulnerability
- Include the impact of the vulnerability
- Include any potential fixes if you have them

### What to Expect

| Timeline | Action |
|----------|--------|
| 48 hours | Initial acknowledgment |
| 7 days | Detailed response and assessment |
| 30-90 days | Fix released (depending on severity) |

We will:
- Acknowledge receipt of your vulnerability report within 48 hours
- Provide a more detailed response within 7 days
- Work on a fix and coordinate the release with you
- Publicly acknowledge your responsible disclosure (unless you prefer to remain anonymous)

### Safe Harbor

We consider security research conducted consistent with this policy to be authorized and will not pursue legal action against researchers who act in good faith.

## Security Best Practices

When using Phantasy Agent:

1. **Environment Variables**
   - Never commit `.env` files to version control
   - Use strong, unique secrets for production
   - Rotate API keys regularly

2. **Authentication**
   - Always enable authentication in production
   - Use strong passwords (we recommend using the password hash generator)
   - Enable rate limiting to prevent brute force attacks

3. **Database**
   - Use SSL/TLS connections in production
   - Enable connection pooling
   - Use prepared statements to prevent SQL injection

4. **API Keys**
   - Store API keys securely (use environment variables or secret management)
   - Never expose API keys in client-side code
   - Use different keys for development and production

5. **Updates**
   - Keep dependencies up to date
   - Monitor security advisories
   - Apply security patches promptly

## Security Features

Phantasy Agent includes several security features:

- JWT-based authentication
- OAuth provider support (GitHub, GitLab)
- Rate limiting and account lockout
- Bcrypt password hashing
- SSL/TLS database connections
- Input validation and sanitization
- CORS configuration and per-integration origin checks
- Security headers on all responses

## Contact

- **Security issues**: security@phantasy.bot
- **General questions**: Open an issue on [GitHub](https://github.com/phantasy-bot/agent/issues)
