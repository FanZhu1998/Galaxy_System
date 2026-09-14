// Four icon definitions from Lucide 1.8.0. ISC license: ./LICENSE.
const icons = {
  "rotate-ccw": [
    [
      "path",
      {
        "d": "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
      }
    ],
    [
      "path",
      {
        "d": "M3 3v5h5"
      }
    ]
  ],
  "rotate-cw": [
    [
      "path",
      {
        "d": "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"
      }
    ],
    [
      "path",
      {
        "d": "M21 3v5h-5"
      }
    ]
  ],
  "zoom-in": [
    [
      "circle",
      {
        "cx": "11",
        "cy": "11",
        "r": "8"
      }
    ],
    [
      "line",
      {
        "x1": "21",
        "x2": "16.65",
        "y1": "21",
        "y2": "16.65"
      }
    ],
    [
      "line",
      {
        "x1": "11",
        "x2": "11",
        "y1": "8",
        "y2": "14"
      }
    ],
    [
      "line",
      {
        "x1": "8",
        "x2": "14",
        "y1": "11",
        "y2": "11"
      }
    ]
  ],
  "zoom-out": [
    [
      "circle",
      {
        "cx": "11",
        "cy": "11",
        "r": "8"
      }
    ],
    [
      "line",
      {
        "x1": "21",
        "x2": "16.65",
        "y1": "21",
        "y2": "16.65"
      }
    ],
    [
      "line",
      {
        "x1": "8",
        "x2": "14",
        "y1": "11",
        "y2": "11"
      }
    ]
  ]
};

export function initializeIcons(root=document) {
  const ns='http://www.w3.org/2000/svg';
  for(const placeholder of root.querySelectorAll('[data-lucide]')) {
    const definition=icons[placeholder.dataset.lucide];
    if(!definition)continue;
    const svg=document.createElementNS(ns,'svg');
    for(const [key,value]of Object.entries({width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,String(value));
    for(const [tag,attributes]of definition){const element=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attributes))element.setAttribute(key,value);svg.appendChild(element);}
    placeholder.replaceWith(svg);
  }
  for(const element of root.querySelectorAll('[data-tooltip]'))element.title=element.dataset.tooltip;
}
