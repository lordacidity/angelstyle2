// Everything the troll (and, during the police scene, the cop) can say in a white
// speech bubble. Tone tracks his mood toward you, which drifts over time and shifts
// with how you treat him — see moodTier() / sayAmbient() over in ../PixelTroll. The
// angry tiers are crude on purpose: an in-house easter egg meant to roast its own
// users. The profanity is intentional.

export const SPEECH = {
  loved:   ["good job!", "you're killing it", "i love you", "you're the best", "proud of you", "keep it up!", "amazing work", "you're a legend", "my hero", "we make a great team", "couldn't do it without ya", "you light up my day", "best coworker ever", "so glad you're here"],
  liked:   ["hey friend :)", "nice work", "lookin' good", "you're doing great", "hi!", "good to see you", "how's the work?", "you've got this", "need anything?", "vibes are good today", "keep crushin' it", "i'm rootin' for ya"],
  neutral: ["hey", "whatcha doin'?", "sup", "hello there", "...", "just vibin'", "how's it going?", "busy day huh", "nice weather in here", "don't mind me", "just hangin' out", "what's the plan?", "long day?", "is it friday yet?", "i'll be around", "mind if i chill here?", "ooh, what's this?", "you smell that?", "what's for lunch?", "i like it here", "nice spot you got", "*yawn*", "anything fun happening?", "how was your weekend?", "lookin' busy", "need a break?", "coffee time?"],
  disliked:["tch.", "whatever", "ugh", "leave me alone", "not now", "go away", "you again?", "hmph", "don't talk to me", "i'm not in the mood"],
  hated:   ["fuck you", "i hate you", "you suck", "you're the worst", "screw you", "i can't stand you", "piss off", "i despise you", "drop dead", "you're garbage"],
  furious: ["go fuck yourself", "fuck you asshole", "i fucking hate you", "you piece of shit", "rot in hell", "eat shit", "fuck off and die", "i'll fucking end you", "worthless sack of shit", "i hope you suffer"],
};
// the super-rare police scene: the troll rats you out, the cop takes notes.
export const POLICE_TROLL = ["officer, THAT one!", "he's been torturing me!", "i want him ARRESTED", "do something!", "he KILLED me. twice!", "write that down!", "you SEE what i deal with?", "he's a menace!", "lock him up!", "i fear for my life", "every single day, officer"];
export const POLICE_COP   = ["mhm.", "noted.", "go on…", "i see.", "uh huh.", "and then?", "duly noted.", "*scribbles*", "interesting…", "mm-hmm.", "we'll look into it."];
export const SPEECH_FED =     { good: ["mmm!", "thank you!", "so good", "yum!", "my favorite", "aw, thanks"], bad: ["...thanks i guess", "fine. thanks.", "still don't like you", "whatever. food."] };
export const SPEECH_GRABBED = { good: ["hey!", "put me down!", "whoa!", "wheee?", "careful!"], bad: ["let GO of me", "get your hands off me", "fuck off!", "don't touch me"] };
export const SPEECH_POKED =   { good: ["hi!", "hee", "that tickles", "hey you", "oh hi"], bad: ["stop poking me", "quit it", "ow", "rude", "knock it off"] };
export const SPEECH_MELT =    ["FUCK OFF", "STOP IT", "GODDAMNIT", "I SAID STOP", "ENOUGH"];
