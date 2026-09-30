# Test fixtures

These floor plans are made up, with a known true answer: a 10 × 8 m house drawn at 100 pixels per metre, with 7 walls, 4 door gaps and 4 windows. Plan 04 is tilted by 2.2 degrees on purpose. They are saved in git so `npm test` works for anyone who downloads the project. Every wall piece is drawn half a wall thickness past each cut, so a door or window gap as drawn is its nominal width minus the thickness of its wall (01: 15 px everywhere; 02: 25 px exterior, 8 px interior; 03 and 04: 20 px exterior, 10 px interior).
