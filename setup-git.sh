#!/usr/bin/env bash
# =============================================================================
#  The Broken Flagon — one-time Git setup (macOS / Linux)
#
#  WHAT THIS DOES:
#    Initializes a git repository in this folder and makes your first commit,
#    capturing the entire game exactly as it is right now as version 0.5.0.
#    Run it once; afterward you just commit normally (see GIT_QUICKSTART.md).
#
#  HOW TO RUN:
#    Open a terminal in your game's root folder and run:
#        bash setup-git.sh
#    (or:  chmod +x setup-git.sh  &&  ./setup-git.sh )
# =============================================================================

set -e

echo
echo "============================================================"
echo "  The Broken Flagon - Git Setup"
echo "============================================================"
echo

# Verify git is installed.
if ! command -v git >/dev/null 2>&1; then
    echo "  [ERROR] Git is not installed."
    echo "          macOS:  xcode-select --install   (or: brew install git)"
    echo "          Linux:  sudo apt install git      (or your package manager)"
    echo
    exit 1
fi

echo "  Git found. Setting up the repository..."
echo

# Initialize (skip if already a repo).
if [ -d ".git" ]; then
    echo "  A git repository already exists here - skipping init."
else
    git init
    echo "  Repository initialized."
fi

# Friendly default branch name.
git branch -M main 2>/dev/null || true

# Set commit identity only if not already configured globally.
if [ -z "$(git config user.name 2>/dev/null)" ]; then
    git config user.name "Brian"
    git config user.email "brian@thebrokenflagon.local"
    echo "  Set commit identity to \"Brian\" (edit setup-git.sh to change)."
fi

# Stage everything (respecting .gitignore) and make the first commit.
git add -A
git commit -m "Initial commit - The Broken Flagon v1.13.0" \
           -m "Baseline snapshot of the full game: 18 JS files, styles, HTML, dev bot controller, and docs. See CHANGELOG.md for history."

echo
echo "============================================================"
echo "  Done. Your game is now under version control."
echo
echo "  From now on, at the end of a work session, run:"
echo "      git add -A"
echo "      git commit -m \"what you changed\""
echo
echo "  See GIT_QUICKSTART.md for the handful of commands you'll use."
echo "============================================================"
echo
