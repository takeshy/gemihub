## Explain how your project meets the main technology requirement.
* Please name each PayPal tool and AI tool (model or AI service) you used and what it does in your project. Requirement: Your project must integrate the PayPal developer platform (using the free sandbox environment) along with an AI tool, model, or platform of your choice.

PayPal (Sandbox)

PayPal REST API (OAuth 2.0): authenticates the server with the Sandbox app’s client ID and secret.
Orders API v2 (create, approve, capture): customers prepay for a booking with PayPal. The server checks the amount before confirming the booking.
Payments API v2 (refund, refund status): when a booking is cancelled, the customer is refunded automatically according to the shop’s refund policy.
Everything runs in the PayPal Sandbox with Sandbox business and buyer accounts.

AI

Google Vertex AI (Gemini): owners build their shop by chat, voice, or by circling part of the screen. Gemini also turns plain-language rules like “50% refund if cancelled the day before” into the shop’s PayPal refund settings.
Gemini function calling: a read-only research agent that answers owner questions (e.g. refund rules, payment status) with sources from live records.
Gemini Live API: voice conversation with the shop assistant.
Gemini image model: generates photos for services and pages.
OpenAI API (optional): another AI provider an administrator can switch to.

How they work together
The AI only proposes payment rules, and the owner approves them. All charges and refunds are calculated and run by the server through PayPal.

## Which additional sponsor tool(s) did you use for this project?

* Reminder: Usage of a Paypal tool and an AI tool is required for all projects. Using the listed sponsors are optional.

None

## How would you rate your overall experience integrating PayPal?

9

## Overall experience rating: Please share why or provide additional feedback.

The PayPal REST APIs were easy to integrate directly without an SDK. Orders v2 (create → approve → capture) and the Refunds API fit our booking flow well, the PayPal-Request-Id header made safe retries possible, and the Sandbox let us test the full payment and refund cycle end to end.

Two things could be improved: (1) Sandbox accounts were confusing at first, because it was easy to mix up the business (merchant) account and the personal (buyer) account. (2) The developer documentation is not available in Japanese, which makes it harder for Japanese developers to get started.

## Which AI tools have you leveraged while working on this project?

In the product:

Google Vertex AI – Gemini: setup interview, reading pen-marked screenshots, page/theme/article generation, settings from notes or URLs, and turning plain-language refund rules into PayPal payment settings
Gemini as an independent reviewer for AI-generated themes
Gemini function calling: a read-only research agent for “Consult & ask”
Gemini Live API: real-time voice assistant
Gemini image model: photos for services and pages
OpenAI API (optional, switchable by the administrator)

During development:

OpenAI Codex and Claude Code: AI coding agents used heavily for implementation, tests and documentation
Google Antigravity: organizing and refining the project documentation
Grok, Muse and dots: consulted as sounding boards for ideas and design decisions; we asked each for its opinion and compared their answers

