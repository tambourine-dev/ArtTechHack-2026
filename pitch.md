# stimul.ai

## Hook (30s)

Stop for a second and listen, sharpen your senses. Notice a low electronic hum, your own breathing, the people behind you, the thing at the edge of your eye. Your brain was ignoring all of it until I said so.

Our brains only process a vanishingly small percentage of the information our bodies transmit, without us even noticing. But this is necessary for our survival: If we didn’t have this filter inside our mind, we would constantly be overstimulated.

We thought: AI models are particularly good at processing insane amounts of information, so why not use it to remove the filter that our brain sets up? 

So we wanted to tackle the following questions in our project:

- How can we use AI to process spatial information?
- How should we make the information available to the user?
- How can we show the information filtered by our consciousness?

## Demo (3-4 min)

(comment demo videos)

## How it works (1-2 min)

Our project is built on the WebXR framework, and hosted on the local network. It can be accessed with a regular smartphone, but you get the intended experience when you use the meta quest 3 virtual reality headset. 

We fed the camera input into the media pipe object detector. Then, our logic checks if the user is gazing at a particular object. After a certain time threshold has passed, we create a partial screenshot of an image and send it to an llm with a prompt. We get a text response back that is read out by a text to speech model.

We connected our web app to lama.cpp, meaning that we had a local instance of an llm running on one of our laptops in the same network.

There is also a separate user interface that controls how many visual stimuli are considered. If the threshold is low, only a small number of bounding boxes is shown. A higher stimuli percentage leads to more boxes and even multiple narrations at the same time, creating a sort of disorienting and overstimulating sensation.

The core theme we wanted to convey with our work was the feeling of being overstimulated, which is why after iterating through different scenarios, we incorporated the glitch effect.

To round off the experience we made the conscious decision to not only focus on the visual layer, but incorporate also music snippets that underline the spatial dimension.

## Backgrounds (aka Who built this?) (30s)

Mischka and I are doing our bachelors in Computer Science at ETH Zürich. Vale graduated from the same major this summer. Lean graduated from her Visual Communication bachelors at F+F this summer.

Vale did a lot of the setup work, making sure the llm server is hooked up and was crucial for the initial part of the project. Mischka did the prototyping for the web app, getting the object recognition to work. Lean incorporated the music and worked on the slides, whereas I got the voice narration working and the pitch.

## What's next (30s)

We wish to expand this project into an exhibition format. We want to incorporate more stimuli that our bodies are able to take in, like audio stimuli or bodily sensations. We want to expand on the descriptions of the objects surrounding us, for example their materials, colors, dimensions or histories. 

The technologies we used lend themselves for more critical analysis: Questions like privacy issues, surveillance, misinformation or biases arise when we blindly let an LLM narrate our surroundings.