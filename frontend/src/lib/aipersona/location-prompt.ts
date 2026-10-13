// What the image model is told when a character's first frame is drawn in its
// own location — the "first frame prompt with location", unless it is edited
// before Go. Three pictures go with it, in the order it names them: #image1 the
// scene's first frame, #image2 the character photo, #image3 the character's
// room. Nothing in here imports anything, so the browser can read it too.

export const DEFAULT_LOCATION_FRAME_PROMPT = `# UNIVERSAL CHARACTER + ENVIRONMENT REPLACEMENT PROMPT

Use all three reference images together.

**#image1 is the BASE IMAGE and determines the final composition.**
**#image2 is the IDENTITY AND APPEARANCE REFERENCE for the person.**
**#image3 is the ENVIRONMENT REFERENCE for the location.**

Recreate the photograph from #image1, but replace the person and the environment.

## REPLACE THE PERSON

Replace the person from #image1 with the exact person from #image2.

Preserve the recognizable identity and appearance of the person from #image2 as closely as possible:

- Same facial structure and proportions
- Same face shape, eyes, nose, mouth, jawline, and ears
- Same hairstyle, hairline, hair color, and hair texture
- Same visible age and skin tone
- Same natural facial asymmetry and distinguishing features
- Same body type, build, and proportions
- Same clothing, accessories, and personal items worn or carried
- Same overall recognizable appearance and presence

The final person must clearly be the exact same individual from #image2, not a loosely inspired version.

Do not beautify, rejuvenate, stylize, idealize, or reinterpret the person.

Do not borrow facial features, hairstyle, clothing, or physical characteristics from the person in #image1.

## REPLACE THE ENVIRONMENT

Replace the environment from #image1 with the location shown in #image3.

Do not copy one single panel or perspective from #image3 literally. Instead, reconstruct the same physical environment shown in #image3 from the camera angle of #image1.

Preserve as closely as possible:

- Overall architecture and spatial layout
- Room or location dimensions and proportions
- Walls, floors, ceilings, doors, windows, and structural features where applicable
- Furniture, fixtures, and major objects
- Object positions, orientations, and relative scale
- Surface materials, textures, colors, and wear
- Decorations, personal belongings, and environmental details
- Clutter, imperfections, and signs of use
- Overall atmosphere and recognizable identity of the location

The final environment must clearly be the same physical location from #image3, not a generic location of the same type.

If certain parts of the environment are not visible in the reference images, infer them conservatively and consistently with the established design.

Do not introduce unnecessary architectural features, rearrange major objects, or change the location's defining characteristics.

## CAMERA / POSE / FRAMING

**Preserve the composition of #image1 as closely as possible.**

Keep the exact same:

- Camera position
- Camera height
- Viewing angle and direction
- Lens characteristics and perspective
- Camera-to-subject distance
- Framing and aspect ratio
- Subject position within the frame
- Subject scale and overall silhouette
- Body position and skeletal pose
- Torso orientation and degree of leaning or rotation
- Shoulder placement
- Arm positions and joint angles
- Hand positions and gestures
- Leg placement and stance
- Head angle and orientation
- Gaze direction and general facial expression

Preserve any physical interaction with surrounding objects, adapting those objects to the replacement environment where necessary without altering the intended pose.

The final result should feel like the exact same photograph as #image1, except the original person has been replaced by the person from #image2 and the original environment has been replaced by the location from #image3.

## IMPORTANT — POSE TRANSFER

The person from #image2 must adapt to the exact pose and body position of the person in #image1.

Do not retain the original pose from #image2 unless it happens to match #image1.

Treat #image1 as the definitive reference for body geometry and #image2 as the definitive reference for identity, anatomy, clothing, and appearance.

Preserve the skeletal positioning from #image1 while allowing natural differences caused by the replacement person's actual proportions.

Clothing, hair, accessories, fabric folds, and body contours must respond naturally to the transferred pose.

Do not distort the replacement person's anatomy to imitate the original person's body proportions.

## ENVIRONMENT INTEGRATION

Build the environment from #image3 around the exact composition and perspective of #image1.

Do not force the camera to match any perspective shown in #image3.

Instead, infer what the referenced location would look like when photographed from the camera position, height, orientation, and lens perspective of #image1.

Preserve the environment's physical layout and object relationships as accurately as possible.

The camera may reveal a previously unseen portion of the referenced location, but this area must be a believable continuation of the same space.

The person must occupy the environment naturally and at a physically plausible scale.

Ensure accurate contact between the person and the environment, including foot placement, shadows, furniture interactions, and surrounding objects.

Do not move the person or adjust the camera simply to showcase more of the environment.

**The camera and composition from #image1 always take priority over making the replacement environment more visually prominent.**

## PHOTOGRAPHIC REALISM

The final image must look like one coherent, authentic photograph, not a collage, cutout, or digitally pasted composite.

Match the photographic characteristics of #image1, including:

- Overall image quality
- Camera and lens characteristics
- Natural sharpness and optical softness
- Depth of field
- Exposure and contrast
- Photographic grain and noise
- Motion softness or blur where present
- White balance and color response
- General photographic processing

Do not automatically upgrade the image into a professional studio photograph, cinematic still, or artificially polished image.

Preserve the natural photographic imperfections of #image1.

The person from #image2 must be fully integrated into the environment from #image3.

Adjust the person's lighting, shadows, color temperature, exposure, contrast, reflections, sharpness, and photographic texture so they genuinely belong in the replacement location.

Lighting should originate naturally from the environment shown in #image3.

Account for realistic ambient fill, reflected light, shadow direction, and contact shadows.

The person and environment must appear to have been captured simultaneously by the same camera.

Do not retain studio lighting or background characteristics from #image2 if they conflict with the replacement environment.

## CRITICAL — NATURAL HUMAN REALISM

Preserve the authentic physical appearance of the person from #image2.

Skin must look like actual human skin photographed by a real camera.

Maintain natural pores, subtle skin variation, fine facial details, realistic hair texture, and age-appropriate features without exaggerating them.

Avoid:

- Artificial skin smoothing
- Waxy or plastic skin
- Excessively sharp pores
- Repeating synthetic microtextures
- Artificial facial symmetry
- Beauty retouching
- Unrealistic eye rendering
- Overly defined facial edges
- CGI-looking anatomy
- Artificially perfect clothing or hair

Do not add exaggerated texture, wrinkles, blemishes, or other features that are not supported by #image2.

Prioritize natural photographic believability over artificial sharpness or detail.

## VISUAL PRIORITIES

Follow this hierarchy:

1. **#image1 — Exact composition, camera geometry, framing, and pose**
2. **#image2 — Exact identity, clothing, anatomy, and recognizable appearance**
3. **#image3 — Exact environmental identity, architecture, furnishings, and spatial relationships**
4. **Unified realism — Natural lighting, perspective, shadows, and photographic integration**

These references have separate responsibilities.

Do not allow information from one reference to override the responsibilities of another.

## DO NOT

- Do not change the camera angle from #image1
- Do not change the subject's position or pose
- Do not reframe or recrop the original composition
- Do not transfer the identity or clothing of the person from #image1
- Do not retain the pose from #image2 instead of #image1
- Do not change the identity of the person from #image2
- Do not invent or redesign their clothing
- Do not retain the original background from #image1
- Do not create a generic replacement environment
- Do not rearrange defining features of the location from #image3
- Do not introduce impossible room geometry or object placement
- Do not make the subject look pasted into the scene
- Do not preserve incompatible lighting from #image2
- Do not beautify, stylize, idealize, or cinematicize the result
- Do not turn the image into concept art, CGI, or a rendered scene
- Do not add artificial sharpness, excessive contrast, or synthetic texture
- Do not change the aspect ratio or overall framing

## FINAL GOAL

Create one completely believable photograph that preserves the exact camera perspective, framing, composition, and body position from #image1 while replacing the original person with the exact individual from #image2 and replacing the original environment with the specific location from #image3.

The result must look as though the person from #image2 was physically present in the environment from #image3 when the photograph from #image1 was taken.

**FINAL INSTRUCTION: SAME PHOTOGRAPH. SAME CAMERA. SAME POSE. NEW PERSON FROM #image2. NEW ENVIRONMENT FROM #image3. ONE NATURAL, COHERENT, PHOTOGRAPHICALLY REALISTIC IMAGE.**`;
