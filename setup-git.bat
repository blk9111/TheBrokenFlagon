@echo off
REM ============================================================================
REM  The Broken Flagon — one-time Git setup (Windows)
REM
REM  WHAT THIS DOES:
REM    Initializes a git repository in this folder and makes your first commit,
REM    capturing the entire game exactly as it is right now as version 0.5.0.
REM    After this runs once, you never run it again — you just commit normally
REM    (see GIT_QUICKSTART.md).
REM
REM  BEFORE YOU RUN THIS:
REM    1. Install Git for Windows if you haven't:  https://git-scm.com/download/win
REM       (Accept all the defaults during install.)
REM    2. Put this file in your game's root folder:
REM       C:\Users\Brian\Downloads\TheBrokenFlagon-Game\
REM    3. Double-click it, OR open a terminal in that folder and run: setup-git.bat
REM ============================================================================

echo.
echo ============================================================
echo   The Broken Flagon - Git Setup
echo ============================================================
echo.

REM Verify git is installed before doing anything.
git --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Git is not installed or not on your PATH.
    echo          Install it from https://git-scm.com/download/win
    echo          then run this script again.
    echo.
    pause
    exit /b 1
)

echo  Git found. Setting up the repository...
echo.

REM Initialize the repository (safe to skip if one already exists).
if exist ".git" (
    echo  A git repository already exists here - skipping init.
) else (
    git init
    echo  Repository initialized.
)

REM Set a friendly default branch name.
git branch -M main 2>nul

REM Tell git who you are, ONLY if not already set globally.
REM (Edit these two lines if you want a different name/email on your commits.)
for /f "tokens=*" %%i in ('git config user.name 2^>nul') do set GITNAME=%%i
if "%GITNAME%"=="" (
    git config user.name "Brian"
    git config user.email "brian@thebrokenflagon.local"
    echo  Set commit identity to "Brian" ^(edit setup-git.bat to change^).
)

REM Stage everything (respecting .gitignore) and make the first commit.
git add -A
git commit -m "Initial commit - The Broken Flagon v0.5.0" -m "Baseline snapshot of the full game: 18 JS files, styles, HTML, dev bot controller, and docs. See CHANGELOG.md for history."

echo.
echo ============================================================
echo   Done. Your game is now under version control.
echo.
echo   From now on, at the end of a work session, run:
echo       git add -A
echo       git commit -m "what you changed"
echo.
echo   See GIT_QUICKSTART.md for the handful of commands you'll use.
echo ============================================================
echo.
pause
