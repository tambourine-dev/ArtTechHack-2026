# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This is a team repo for the ArtTechHack 2026 hackathon. It has no code, build system, or tests yet. The only content is `brainstorm.md`, the team's shared ideation notes.

## Stack

- **Client:** Unity, written in C#.
- **Backend:** a separate service that handles the AI requests. The Unity client talks to it using OMT.

Add build/run commands and project layout here once the Unity project and backend are in the repo.

## Challenge

The team is working on **Challenge 03 – Spatial AI & The Mind**: build an interactive system, generative tool, game, or VR/XR experience using Gaussian splatting and eye-tracking, with a focus on the human mind and spatial decision-making.

Recurring themes in the brainstorm that should guide implementation choices:
- Surveillance and vulnerability: gaze and movement tracking made visible to the participant.
- Two-person setup: one person in VR, another person controlling or observing.
- Generative rather than hardcoded: the participant can tune parameters live, such as the tracking intensity via a slider.
- Moral neutrality: the experience should let participants form their own feelings instead of telling them what to feel.
- Candidate tech mentioned so far: ml5.js and open-source hand/body/pose tracking models, plus immersive sound.

## Working in this repo

- `brainstorm.md` is edited by several teammates and mixes English and German. Keep the existing language when editing a section, and add to it rather than rewriting other people's entries.
