# Security & Privacy Policy

Privacy and security are the core directives of this project. Our system architecture enforces a **Strict Zero-PII Data Egress Guarantee**.

## Threat Model & Guarantees

1. **Local-First Processing:**
   - Raw DOM elements, passwords, credit card inputs, and visual screen content are evaluated **exclusively on the client-side device**.
   - No unmasked screenshot ever touches a remote network socket.

2. **Sanitizer Pipeline Integrity:**
   - Redaction occurs at two independent layers: DOM-attribute level (`type="password"`, regex PII detectors) and Canvas Pixel level (Object Detection bounding boxes).
   - Solid opacity masking (`#000000`) is burnt directly into the image canvas prior to Base64/JPEG conversion.

3. **In-Flight Data Isolation:**
   - Server communication is restricted to TLS-encrypted WebSockets (`wss://`).
   - Server-side models process sanitized frames purely in-memory and execute no persistent data logging.

## Reporting a Vulnerability

If you identify a data leak, over-redaction bug, or security vulnerability:

1. **Do NOT open a public GitHub issue.**
2. Email the maintainers directly at `security@yourproject.domain` with reproducible steps and proof-of-concept details.
3. You will receive a response within 24 hours detailing our remediation plan.
