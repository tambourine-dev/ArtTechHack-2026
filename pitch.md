# stimul.ai

## Hook (30s)

Stop for a second and listen, sharpen your senses. Notice a low electronic hum, your own breathing, the people behind you, the thing at the edge of your eye. Your brain was ignoring all of it until I said so.

Our brains only process a vanishingly small percentage of the information our bodies transmit, without us even noticing. But this is necessary for our survival: If we didn’t have this filter inside our mind, we would constantly be overstimulated.

We thought: AI models are particularly good at processing insane amounts of information, so why not use it to remove the filter that our brain sets up? 

So we wanted to tackle the following questions in our project:

- How can we use AI to process spatial information?
- How should we make the information available to the user?
- How can we make the user experience how much information they filter out?

## Demo (3-4 min)

(comment demo videos)

## How it works (1-2 min)

Our project is built on the WebXR framework, and hosted on the local network. It can be accessed with a regular smartphone, but you get the intended experience when you use the meta quest 3 virtual reality headset. 

We fed the camera input into the media pipe object detector. Then, our logic checks if the user is gazing at a particular object. After a certain time threshold has passed, we create a partial screenshot of an image and send it to an llm with a prompt. We get a text response back that is read out by a text to speech model.

We connected our web app to lama.cpp, meaning that we had a local instance of an llm running on one of our laptops in the same network.

There is also a separate user interface that controls how many visual stimuli are considered. If the threshold is low, only a small number of bounding boxes is shown. A higher stimuli percentage leads to more boxes and even multiple narrations at the same time, creating a sort of disorienting and overstimulating sensation.

After iterating through different scenarios and experimenting with we agreed on a simpler visual identity and use these simpler bounding boxes to 

To round off the experience we made the conscious decision to not only focus on the visual layer, but incorporate also music snippets that underline the spatial dimension.

## Backgrounds (aka Who built this?) (30s)

Im Tamara, i'm doing my bachelors in computer science in the third year. I recently did a live coding set for the artist collective unsorted.love.

Mischka studies in the same year as me and also shares an interest in art. She likes to do ascii live coding.

Vale graduated from the ETH CompSci bachelor this summer. Right now he's working in tech, so he arguably has the most programming experience from all of us.

Lean graduated this summer from her graphic design studies at F+F. She likes electronic music and synthesizers. You can catch her at the live video festival on the 21st of November where she’ll be doing a live coded performance. 

## What's next (30s)

We wish to expand this project into an exhibition format. We want to incorporate more stimuli that our bodies are able to take in, like audio stimuli or bodily sensations. We want to expand on the descriptions of the objects surrounding us, for example their materials, colors, dimensions or histories. 
