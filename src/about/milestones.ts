/**
 * Timeline content — PRD §8.2.
 *
 * The prints themselves are pressed by src/about/trail.ts, as one mask stamp
 * rather than as `press` brushes — see that file for why. Hover or scrub
 * pressing one deeper is not built yet.
 *
 * What IS here is the content, and §12 wants it to stand on its own anyway:
 * every milestone is real text, readable with the canvas removed. The list is
 * also what gives About its scroll length, which is what drives the camera up
 * the beach (§13, Phase 2) now that the placeholder spacer is gone.
 */

export interface Milestone {
  id: string;
  /** The date, as shown. Painted in capitals on the sign. */
  label: string;
  /** Where, and what — the two short lines painted under the date. Kept
   *  short (~20 characters): a sentence on a half-metre board is unreadable a
   *  few metres away. */
  org: string;
  role: string;
  /** The full line, for the DOM: screen readers, search, no-WebGL (§12). */
  detail: string;
  /** What is written inside the sign's scroll — a few sentences, read zoomed in. */
  story: string;
  /**
   * World Z of the print.
   *
   * The trail starts just past the "Timeline" signpost (z 5.0, sign.ts) and
   * runs up to 9.0. Everything above z≈4.6 is behind the camera
   * at the top of the page, so the sign and then the prints walk in from the
   * bottom of the screen as you scroll. 9.0 is about the highest a print can
   * sit and still be clear of the bottom edge when the scroll ends (camera
   * target 7.6, the ground at the screen's bottom edge ~1.8 beyond it).
   *
   * Ordered with `now` lowest on the beach, so scrolling travels backwards
   * through time. Erosion is keyed to AGE, not distance (see trail.ts).
   */
  z: number;
}

/**
 * Newest first: the walk starts at "Now" by the signpost and heads back in
 * time up the beach. Seven milestones across z 5.4–11.0, ~0.93 apart, each with
 * its own sign beside its prints (sign.ts). Not past ~0.6 beyond the camera's
 * endZ (scroll.ts, 10.4), so the last
 * sign is not right under the lens when the scroll ends.
 */
export const MILESTONES: Milestone[] = [
  {
    id: "dow", z: 5.4, label: "Now",
    org: "Dow", role: "Data platform intern",
    detail:
      "Data platform engineering intern at Dow, automating data governance across 1,200+ Databricks resources a day and building LangGraph agents that check code before it ships.",
    story:
      "Built an automated data-governance pipeline in Python on Azure and Databricks that checks 1,200+ resources a day, replacing work that used to cost dozens of engineer-hours. Now building LangGraph agents that review code before they file pull requests, and MCP servers for chemical-manufacturing tools.",
  },
  {
    id: "engelken", z: 6.33, label: "Dec 2025",
    org: "Engelken Lab", role: "Spiking neural nets",
    detail:
      "Joined the Engelken Lab at Illinois, scaling spiking neural network simulations from 10,000 to 100,000 neurons in Julia.",
    story:
      "Scaled spiking neural network simulations from 10,000 to 100,000 neurons, modelling the cortex as a high-dimensional dynamical system. Wrote a leaky integrate-and-fire network in Julia that runs 15\u00d7 faster than the Brian2 reference, and now exploring transformer-inspired spiking architectures.",
  },
  {
    id: "motate", z: 7.27, label: "Summer 2025",
    org: "Motate", role: "Software intern",
    detail:
      "Software engineering intern at Motate in San Jose, building the serverless AWS pipeline behind AI dubbing and lip-sync in 15+ languages.",
    story:
      "Built the serverless AWS side of an AI dubbing and lip-sync service in 15+ languages: Terraform, Step Functions, Lambda and SageMaker. Tuned the voice-cloning pipeline, and wrote the APIs behind sign-up, video upload and translation status.",
  },
  {
    id: "attune", z: 8.21, label: "Feb 2025",
    org: "Attune", role: "EEG + VR therapy",
    detail:
      "Started building EEG models at Attune NeuroFeedback: attention, emotion and stress signals for a VR therapy game.",
    story:
      "Built the models behind a VR neurofeedback therapy game: a BiLSTM that reads attention from EEG at 85% accuracy, real-time emotion recognition from facial meshes, and a multiscale-entropy stress signal ahead of clinical trials.",
  },
  {
    id: "divergence", z: 9.15, label: "Sep 2024",
    org: "Divergence 2%", role: "LLM inference research",
    detail:
      "Undergraduate researcher at Divergence 2%, making conversational AI characters fast and human-like: LLM inference, fine-tuning and evaluation.",
    story:
      "Cut response time for conversational AI characters from ~40 s to ~1.5 s with ONNX, TensorRT, vLLM, quantization and batching. Trained across 4 H100s with a custom fused-attention CUDA kernel, and fine-tuned 70B-parameter models with LoRA-based DPO to sound more human.",
  },
  {
    id: "illinois", z: 10.1, label: "Fall 2024",
    org: "Illinois", role: "CS + Bioengineering",
    detail:
      "Started Computer Science & Bioengineering at the University of Illinois: classes, intramural soccer, frisbee, and exploring Champaign-Urbana. Also leading iMADE's heart-attack detection team.",
    story:
      "Started CS + Bioengineering at UIUC, with classes in deep learning, computer vision, systems programming and soft robotics. Outside class: intramural soccer, frisbee, and exploring Champaign-Urbana for cool spots. Also leading iMADE's team of 8 building a heart-attack detector.",
  },
  {
    id: "science-gurus", z: 11.0, label: "Summer 2023",
    org: "Science Gurus", role: "Bioinformatics intern",
    detail:
      "Where it started: a bioinformatics internship at Science Gurus, looking for genetic markers of NMOSD.",
    story:
      "Trained a model to find genetic markers of NMOSD, separating seronegative from seropositive patients, and found that 9% of patients on Tocilizumab relapse badly. Presented the results to the founder of Aarvik Therapeutics.",
  },
];
