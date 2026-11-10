// ============================================================================
// MINI-AGENTE: Gemini + herramienta "tirar un dado de N caras"
// ============================================================================
// Este script muestra el ciclo clásico de "tool use" (uso de herramientas):
//   1. Le mandamos al modelo un prompt y le decimos qué herramientas tiene.
//   2. El modelo, en lugar de responder directamente, puede pedir "quiero
//      usar la herramienta X con estos parámetros".
//   3. Nosotros (el código, NO el modelo) ejecutamos esa función de verdad.
//   4. Le devolvemos el resultado al modelo como si fuera un nuevo mensaje.
//   5. El modelo ya tiene el dato real y nos da la respuesta final en texto.
// ============================================================================

// 1. Cargamos las variables de entorno desde el archivo .env (por ejemplo
//    GEMINI_API_KEY). Esto evita escribir la API key directamente en el código.
//    El .env vive dentro de esta misma carpeta (mini-agente/.env).
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

// 2. Importamos el cliente oficial del SDK de Gemini.
const { GoogleGenAI, Type } = require("@google/genai");

// 3. Creamos el cliente. Internamente usará la variable de entorno
//    GEMINI_API_KEY (o GOOGLE_API_KEY) si no le pasamos la key a mano.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ----------------------------------------------------------------------------
// LA HERRAMIENTA (la función real de JavaScript)
// ----------------------------------------------------------------------------
// Esta es la función que de verdad "tira el dado". El modelo NUNCA ejecuta
// código: solo nos puede PEDIR que la llamemos, con los argumentos que él cree
// correctos. Nosotros decidimos si confiamos en esos argumentos y ejecutamos.
function rollDice(sides) {
  const n = Number(sides) || 6; // si no viene un número válido, usamos 6 caras
  const result = Math.floor(Math.random() * n) + 1;
  console.log(`[herramienta] Tirando un dado de ${n} caras... salió: ${result}`);
  return { result, sides: n };
}

// ----------------------------------------------------------------------------
// LA "DECLARACIÓN" DE LA HERRAMIENTA (lo que el modelo ve)
// ----------------------------------------------------------------------------
// Esto NO es código ejecutable para el modelo: es solo una descripción en
// formato JSON Schema de qué hace la función y qué parámetros espera.
// El modelo la usa para decidir CUÁNDO pedir la herramienta y CON QUÉ
// argumentos rellenarla.
const rollDiceDeclaration = {
  name: "roll_dice",
  description: "Tira un dado de N caras y devuelve el número que salió.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      sides: {
        type: Type.NUMBER,
        description: "Número de caras del dado (ej: 6, 20, 100).",
      },
    },
    required: ["sides"],
  },
};

// ----------------------------------------------------------------------------
// FUNCIÓN PRINCIPAL: el ciclo del agente
// ----------------------------------------------------------------------------
async function main() {
  const modelo = "gemini-3.1-flash-lite";

  // "contents" es el historial de la conversación que le vamos mandando al
  // modelo. Empieza solo con el mensaje del usuario, pero iremos agregando
  // la respuesta del modelo y el resultado de la herramienta a medida que
  // avanza el ciclo.
  const contents = [
    {
      role: "user",
      parts: [{ text: "Tira un dado de 20 caras y dime qué número salió." }],
    },
  ];

  // Config común que le pasamos en cada llamada: qué modelo usar, qué
  // herramientas tiene disponibles, etc.
  const config = {
    tools: [{ functionDeclarations: [rollDiceDeclaration] }],
  };

  // --- PASO 1: primera llamada al modelo -----------------------------------
  // Le mandamos el prompt + la lista de herramientas disponibles.
  // El modelo puede responder con texto normal, o con una "functionCall"
  // pidiendo que ejecutemos roll_dice.
  let response = await ai.models.generateContent({
    model: modelo,
    contents,
    config,
  });

  // "functionCalls" es un getter del SDK que extrae, si existen, las
  // llamadas a función que el modelo pidió en su respuesta.
  const functionCalls = response.functionCalls;

  if (functionCalls && functionCalls.length > 0) {
    // --- PASO 2: el modelo pidió usar la herramienta -----------------------
    const call = functionCalls[0];
    console.log(`[modelo] Pide usar la herramienta "${call.name}" con args:`, call.args);

    // --- PASO 3: ejecutamos la función real en nuestro código -------------
    // OJO: aquí es donde nosotros, los desarrolladores, tenemos el control.
    // El modelo solo propuso la llamada; nosotros decidimos ejecutarla.
    let functionResult;
    if (call.name === "roll_dice") {
      functionResult = rollDice(call.args.sides);
    } else {
      functionResult = { error: `Herramienta desconocida: ${call.name}` };
    }

    // --- PASO 4: devolvemos el resultado al modelo -------------------------
    // Para esto hay que reconstruir el historial de la conversación:
    //   a) agregamos el turno del modelo TAL CUAL lo devolvió la API (no lo
    //      reconstruimos a mano: los modelos Gemini 3.x adjuntan una firma
    //      interna "thoughtSignature" a la parte de la functionCall, y si la
    //      perdemos la API rechaza el siguiente turno con error 400).
    //   b) agregamos un turno nuestro con el "functionResponse" (el resultado)
    contents.push(response.candidates[0].content);
    contents.push({
      role: "user",
      parts: [
        {
          functionResponse: {
            name: call.name,
            response: functionResult,
          },
        },
      ],
    });

    // Segunda llamada: ahora el modelo ya tiene el resultado real del dado
    // y puede generar su respuesta final en lenguaje natural.
    response = await ai.models.generateContent({
      model: modelo,
      contents,
      config,
    });
  }

  // --- PASO 5: mostramos la respuesta final del modelo ----------------------
  console.log("\n[respuesta final del modelo]:");
  console.log(response.text);
}

main().catch((err) => {
  console.error("Error en el agente:", err);
});
