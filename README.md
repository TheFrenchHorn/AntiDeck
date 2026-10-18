# AntiDeck

AntiDeck is a lightweight TCG deck builder that runs as a Google Apps Script web app. It is designed for people who need a simple deck-building tool when other sites are blocked by school, work, or network restrictions.

AntiDeck includes an integrated AI assistant, supports multiple card games, and uses public card and deck data APIs to help users build, refine, and manage decks quickly without requiring a user account or login.

## Features

- Google Apps Script web app deployment
- No login required
- Integrated AI assistant for deck suggestions and guidance
- Designed for users in restricted environments where common deck sites are blocked
- Supports Magic: The Gathering and Pokémon deck building
- Uses public APIs for card and deck data
- Lightweight and easy to host

## Why AntiDeck?

Many deck-building tools are blocked in environments like schools or workplaces. AntiDeck provides a simple alternative that runs through Google Apps Script and can be deployed as a web app with minimal setup. It is meant to be quick, private, and accessible.

## AI Features

If you self-host AntiDeck and want to enable the AI assistant, you will need API keys for:

- Gemini
- Grok

Both are free to obtain for basic use.

Recommended script property names:
- GEMINI_API_KEY
- GROK_API_KEY

If these keys are not set, the app can still function as a deck builder, but AI-powered features will be unavailable.

## Public APIs Used

AntiDeck uses publicly available APIs for card and deck-related data, including:

- Scryfall
- EDHREC
- Commander Spellbook
- TCGdex

These services provide card information, deck references, and related assets used by the app.

## How to Use

1. Open the deployed web app, or deploy your own copy.
2. Select the game type (for example, Magic: The Gathering or Pokémon).
3. Add cards to your deck.
4. Adjust counts and deck composition.
5. Use the AI assistant for suggestions if enabled.
6. Build and refine your deck as needed.

## Deploying the App

### Option 1: Use the Hosted Web App

If a deployed version already exists, open the web URL and use it directly.

### Option 2: Deploy Your Own Copy

1. Open Google Apps Script.
2. Create a new project or import the project files.
3. Open the `Code.gs` file and review the server-side logic.
4. In Apps Script, go to Deploy > New deployment.
5. Choose Web app as the deployment type.
6. Set the appropriate access settings.
7. Deploy and copy the generated URL.

Note: Google Workspace admins may restrict anonymous access, so deployment permissions may vary depending on your environment.

## Configuration

To enable AI features, add the following script properties in Apps Script:

- `GEMINI_API_KEY`
- `GROK_API_KEY`


Project Structure
Code.gs — backend Apps Script logic
index.html — web app frontend
Additional HTML or JavaScript files may be included depending on the version
Important Files
Code.gs
index.html
These are the main entry points for understanding how the app works and how to customize it.

# Maintainer
The project is maintained by TheFrenchHorn.

# License
This project is licensed under the MIT License. See the MIT License below for details.

MIT License

Copyright (c) 2026 TheFrenchHorn

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Notes
AntiDeck is provided as-is.
Use it responsibly and according to the rules of the games you are playing.
AI responses depend on external services and may vary in accuracy or availability.
Disclaimer
This project is intended for personal and educational use. Card data and AI suggestions are dependent on external APIs and services, which may change over time.
