The player can load in and choose between singleplayer (playing against an algorithm) or multiplayer. In either instance, the player and the opponent are given a semi-randomized "matrix" of expected outcomes for each possible pairing. This will either be in an integer score between 0-20 in "20-0 mode" - this should look something like a visual matrix with numbers 0-4 highlighted in red, 5-8 highlighted in orange, 9-11 highlighted in yellow, 12-15 highlighted in light green, and 16-20 highlighted in dark green. In Atlas mode this is similar, though the possible scores are restricted to exactly {1,2,2.5,3,3.5,4,5}

The matrixes for each possible matchup should be similar for the opponent (though reversed) but not identical - a random variance of -3 to +3 in the score is incorporated. Atlas mode handles variance differently, with one step change possible.

The process in which pairings are done is as such: each team has 8 armies and there are 8 possible tables. 

Round 1:
Team A and Team B secretly choose their defender (one army from their pool) and reveal them simultaneously. After that, Team A and team B secretly choose their two attackers (also armies from their pool) for the given defender and reveal them simultaneously. Team A takes the two attackers given by team B, and secretly chooses which one is refused. Team B does the same with the two attackers selected by team A. The refused Attackers are revealed simultaneously and return to the pool of available armies. Captains roll off to determine which team will get to choose its table first. That team gains the “table choice” token. At this point, two defenders know their attackers; this identifies two games. Log this on the score sheet. The Team with the “table choice” token lets his defender choose the table first followed by the defender who's team didn’t have the table choice token. Two tables are now no longer available. 

Round 2:
Repeat Step 1 with the difference that the Team without the “table choice” token now becomes the owner of this token throughout this pairing step. 

Scrum: Change “table choice” token again during this pairing step. This step will identify the remaining 4 games: 2 games “attacker vs. defender”, 1 game between refused attackers and 1 game with the remaining players. Team A and team B secretly choose their defender and reveal them simultaneously.  After that, Team A and team B secretly choose their two attackers for the given defender and reveal them simultaneously. 

At this point there is only one last player available remaining in each team. These are automatically designated as being the last matchup. Each team immediately notes this on their round pairing log-sheet. Team A takes the two attackers given by team B, and secretly chooses which one is refused. Team B does the same with the two attackers selected by team A. The refused Attackers are revealed simultaneously. They will automatically be designated to play the 7th game of the round and face each other. Defenders know their attackers; this identifies two matches. Log this on the score sheet. Team with the “table choice” token let his defender choose the table and then teams alternate choosing tables, starting with the defending players first.

Background
The project is a 40k pairings simulator. The spec file outlines the pairing process, where each team brings eight armies and teams alternate defender/attacker selections with a “table choice” token.

Objectives
Provide an intuitive visual interface for selecting armies and performing the pairing steps described in the spec.

Include army logos to improve clarity and immersion.

Support both singleplayer (vs. algorithm) and multiplayer modes.

Interface Overview
Army Display
Army Slots: Display eight army slots per team, laid out side-by-side or in two rows.

Logos: Each army slot shows the army’s logo and name. If no logo is provided, a placeholder image is shown.

Hover/Click Info: Hovering reveals additional details (e.g., faction, list summary). Clicking selects the army for defender/attacker roles.

Pairing Matrix
Render a colour‑coded matrix:

For 20-0 mode:
0–4 red, 5–8 orange, 9–11 yellow, 12–15 light green, 16–19 dark green, 20 light blue.

For Atlas mode:
1 red, 2 dark orange, 2.5 light orange, 3 yellow, 3.5 light green, 4 dark green, 5 light blue.

Each row corresponds to one of Team A’s armies; each column corresponds to one of Team B’s armies.

Clicking a defender selects that row, and the interface prompts for two attackers from the opposing side.

Pairing Steps
Defender Selection
Both teams choose a defender simultaneously (UI allows each side to lock in their choice).

Attacker Selection
Each side picks two attackers for the opponent’s defender. Choices remain hidden until both sides confirm.

Refusal Phase
Each team chooses one of the two presented attackers to refuse. The unrefused attacker proceeds to the pairing; the refused attacker returns to the pool.

Table Choice Token
When the interface reaches the table selection portion, show a highlighted token indicating which team currently picks first.

A log panel records each pairing step as described in the spec: chosen defenders, attackers, tables, and refused options.