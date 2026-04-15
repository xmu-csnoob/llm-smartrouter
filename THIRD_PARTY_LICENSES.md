# Third-Party Licenses

This project incorporates third-party components under their respective licenses.

## bert-tiny-llm-router

**Model:** `leftfield7/bert-tiny-llm-router`  
**Source:** https://huggingface.co/leftfield7/bert-tiny-llm-router  
**License:** MIT License  
**Copyright:** leftfield7

### MIT License

```
MIT License

Copyright (c) 2024 leftfield7

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Usage in This Project

This model is used for intelligent request routing complexity prediction. The model:
- Weights approximately 4.4MB
- Performs CPU inference in <10ms
- Classifies requests into complexity tiers (simple/medium/complex)
- Is cached locally in `./models/cache/` directory

The model is downloaded from HuggingFace on first launch and used as a component of the routing scoring system. When ML routing is enabled (`ml_routing.enabled: true` in config.yaml), the model provides probability distributions that are weighted and combined with other routing features.

---

## Transformers Library

**Source:** https://github.com/huggingface/transformers  
**License:** Apache 2.0  
**Copyright:** Copyright 2018-2024 The HuggingFace Team. All rights reserved.

Used for loading and running the bert-tiny-llm-router model.

---

## PyTorch

**Source:** https://github.com/pytorch/pytorch  
**License:** BSD 3-Clause / Apache 2.0 (dual license)  
**Copyright:** Copyright (c) Meta Platforms, Inc. and affiliates.

Used as the tensor computation backend for model inference.
