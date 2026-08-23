# Client Integration Examples — UPC Engine API

The UPC Engine exposes a lightweight REST JSON API (`src/server/index.mjs`)
that can be called from any web or mobile application.

Default server URL: `http://localhost:3842`

---

## 1. Web / JavaScript (Browser or Node.js)

```javascript
async function convertBarcode(code, profile = 'upc_a_as_ean13') {
  const response = await fetch('http://localhost:3842/api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, profile })
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error);
  }
  return await response.json();
}

// Example usage:
// const result = await convertBarcode('036000291452', 'upc_a_no_leading_digit');
// console.log(result.output); // '3600029145'
```

---

## 2. .NET / C# (.NET 6+)

```csharp
using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;

public class UpcEngineClient
{
    private readonly HttpClient _client = new HttpClient { BaseAddress = new Uri("http://localhost:3842") };

    public async Task<string> ConvertAsync(string code, string profile)
    {
        var payload = new { code, profile };
        var response = await _client.PostAsJsonAsync("/api/convert", payload);
        response.EnsureSuccessStatusCode();
        
        var result = await response.Content.ReadFromJsonAsync<ConversionResponse>();
        return result?.output ?? throw new Exception("Conversion failed");
    }
}

public record ConversionResponse(string input, string profile, string output);
```

---

## 3. iOS / Swift

```swift
import Foundation

struct ConvertRequest: Codable {
    let code: String
    let profile: String
}

struct ConvertResponse: Codable {
    let input: String
    let profile: String
    let output: String
}

func convertBarcode(code: String, profile: String, completion: @escaping (Result<String, Error>) -> Void) {
    guard let url = URL(string: "http://localhost:3842/api/convert") else { return }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    
    let body = ConvertRequest(code: code, profile: profile)
    request.httpBody = try? JSONEncoder().encode(body)
    
    URLSession.shared.dataTask(with: request) { data, response, error in
        if let error = error { completion(.failure(error)); return }
        guard let data = data else { return }
        do {
            let res = try JSONDecoder().decode(ConvertResponse.value, from: data) // or self
            completion(.success(res.output))
        } catch {
            completion(.failure(error))
        }
    }.resume()
}
```

---

## 4. Android / Kotlin

```kotlin
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

@Serializable
data class ConvertRequest(val code: String, val profile: String)

@Serializable
data class ConvertResponse(val input: String, val profile: String, val output: String)

class UpcEngineClient(private val baseUrl: String = "http://localhost:3842") {
    private val client = OkHttpClient()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    fun convert(code: String, profile: String, callback: (String?) -> Unit) {
        val reqBody = Json.encodeToString(ConvertRequest(code, profile)).toRequestBody(jsonMediaType)
        val request = Request.Builder().url("$baseUrl/api/convert").post(reqBody).build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { callback(null) }
            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string()
                if (response.isSuccessful && body != null) {
                    val res = Json.decodeFromString<ConvertResponse>(body)
                    callback(res.output)
                } else {
                    callback(null)
                }
            }
        })
    }
}
```
