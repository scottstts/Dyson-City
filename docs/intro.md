# Intro

*Context:* this is a short film/animation script (like screenplay script, not code script) for the intro of the game, around 30 seconds to 1 min. This will be 100% staged and rendered at runtime--not a pre-rendered video. when the game loading finishes, this intro animation plays, fully first person pov (without player character mesh in the scene, the character is purely just a camera representing the head and the eyes). When the intro finishes, to the "Enter" screen of the game start. Player also has the option to skip intro by pressing Enter key, which will take them to the same "Enter" screen of the game start.

## Scene

**Scene 1** Start with black screen (indicating I'm half asleep--"I" used here as the character whose first person pov this animation uses), suddenly i wake up, I open my eyes, blink a few more times, I see I am in a spaceship, in the pilot seat, i look around to see more of the ship interior, and outside the windshield i see the dyson sphere, but the ship is outside of it, but close enough to take up most of the view

I hear a voice, the voice of AI on the ship.

AI (#1): Hello, Guardian! How was your nap? We have arrived at the Dyson sphere. It will still take approximately five hours to reach Dyson City. In the meantime, please pace yourself and enjoy the view. I will notify you as soon as we land.

Me (#2): Thank you Aurelia. Wow! This is incredible! I can't believe I'm actually here. Alpha Centauri A...Feels like a dream.

The ship is still moving towards the Dyson sphere but it is too big, so it barely seems to be visibly closer. I look at the ship monitor mounted on my right side, I see diagrams of the Alpha Centauri A and the Dyson sphere structure around it, all stats seem to be nominal

Cut to next scene. fade out to black and fade in again

**Scene 2** Now We're very close to the Dyson city, the dome is visibly below and ahead of the ship. the ship seems to be moving gradually closer to the dome and at the same time descending.

AI (#3): Guardian, we're about to arrive at the destination. I have established contact with Dyson City autonomous control. It appears that everything is fully operational. We are beginning to descend, landing soon.

Me (#4): Okay, got it. Make sure you bring the ship down smoothly please.

AI (#5): Will do!

The ship finally descends to the ground level, with a slight quake and a banging noise from the landing gear, we have landed on the ground, on the inner side of the Dyson sphere, just outside the Dyson City west gate

AI (#6): We have landed, Guardian, just outside the dome. Ahead of us is the west gate of the city. I have taken the liberty of inputing your authentication info, everything is ready!

Me (#7): Thanks Aurelia! That was some awesome maneuver you did there with the landing. I guess this is it. I'll see you in a few years.

AI (#8): You're welcome. By the way, I have uploaded a version of me with my memories onto the Dyson City autonomous control, so I'm afraid you will see a lot of me.

Me (#9): Oh, I didn't know you could do that. I guess I'll see you inside then!

Cut to next scene, fade out to black and fade in again

**Scene 3** I walk towards the door of the ship which gradually slides open as i approach, i walk down the stairs and get off the ship. I look walk a few steps towards the west gate, and i stop, i look back at the ship, whose stairs are retracting and the door is sliding to close. once it's fully closed, the engine starts up, it rises, turns around, and then take off, higher and higher until i cannot see it anymore, i then turn my head back to the west gate

Intro ends, to the game entry screen

## Build info

Here's the info you need associated with the script above that you need to know for the building:

- The intro is a standalone animation, you can change tune the game world, to make it look good in the intro, but yoou must not change anything in the game currently, whatever settings you use in intro stays in intro, not affecting the existing game
- the ship should be designed in a different style than the existing gold-ivory style, should be mostly black
- the dialogues will be separate audios (#1-#9), which you plant at the right timing in the animation you build
- the sound effects will be included as well
- throughout scene 1 and 2, there will be an ambient sound playing constantly, that is the sound inside a moving ship
- all dialogues are in public/intro-audio/, which you use directly in game, but modulated and attenuated by environment
- all the sound effects are in refs/audio/intro/, which you mimic and make them procedural in game, modulated and attenuated by environment as other sound effects
- you can add some additional procedural sounds like beeping inside the ship, engine shut down pitch drop sound, landling muffed thud, etc. you can also borrow some existing sound samples (refs/audio) or existing procedural sounds, morph a bit to suit similar cases, like the gate mechanical motor sound can be adapted for door sliding or stair extending/retracting. Just make sure you don't alter any existing sounds. when you make procedural sounds that don't have a sample to mimic, you need to really make it realistic and avoid any cartoonish sound effects
- audio related doc see docs/audio.md