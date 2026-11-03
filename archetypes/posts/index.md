---
title: "{{ replace .File.ContentBaseName "-" " " | strings.FirstUpper }}"
date: {{ now.Format "2006-01-02" }}
category: technical        # technical | research | personal
tags: []
description: ""
draft: true                # set to false (or delete this line) to publish
---

Write here. Put images in this folder and use ![caption](image.png).
