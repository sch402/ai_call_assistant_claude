import XCTest
@testable import CallAssistant

final class ForwardingCodeTests: XCTestCase {
    private let number = "+61258496666"

    func testCodes() {
        XCTAssertEqual(ForwardingCode.allConditional.code(number: number, waitSeconds: 20), "**004*+61258496666**20#")
        XCTAssertEqual(ForwardingCode.noReply.code(number: number, waitSeconds: 15), "**61*+61258496666**15#")
        XCTAssertEqual(ForwardingCode.busy.code(number: number, waitSeconds: 20), "**67*+61258496666#")
        XCTAssertEqual(ForwardingCode.unreachable.code(number: number, waitSeconds: 20), "**62*+61258496666#")
        XCTAssertEqual(ForwardingCode.cancelAll.code(number: "", waitSeconds: 20), "##004#")
        XCTAssertEqual(ForwardingCode.queryNoReply.code(number: "", waitSeconds: 20), "*#61#")
    }

    func testWaitIsClampedToCarrierValues() {
        XCTAssertEqual(ForwardingCode.clampWait(3), 5)
        XCTAssertEqual(ForwardingCode.clampWait(23), 20)
        XCTAssertEqual(ForwardingCode.clampWait(60), 30)
    }

    func testMissingNumberGivesNoCode() {
        XCTAssertNil(ForwardingCode.allConditional.code(number: "", waitSeconds: 20))
        XCTAssertNil(ForwardingCode.busy.code(number: "+61", waitSeconds: 20))
    }
}

final class DecodingTests: XCTestCase {
    func testPostgresTimestampsWithMicroseconds() {
        XCTAssertNotNil(APIDate.parse("2026-10-19T03:59:50.123456+00:00"))
        XCTAssertNotNil(APIDate.parse("2026-10-19T03:59:50Z"))
        XCTAssertEqual(APIDate.trimFraction("2026-10-19T03:59:50.123456+00:00"), "2026-10-19T03:59:50.123+00:00")
    }

    func testCallDecoding() throws {
        let json = """
        {"calls":[{"id":"6c1f0b9e-0000-4000-8000-000000000001","created_at":"2026-10-19T03:59:50.123456+00:00",
        "call_sid":"CAx","from_number":"+61420576667","forwarded_from":"+61478558140","attributed":true,
        "stir_verstat":null,"caller_country":"AU","status":"completed","match_method":"call_sid","ended_reason":"hangup",
        "duration_seconds":42.5,"summary":"诊所确认预约","transcript":"AI: Hello?",
        "structured":{"caller_name":"Sarah","organization":"City Clinic","purpose":"Confirm appointment",
        "category":"business","urgency":"medium","scam_risk":5,"scam_reasons":[],"recommended_action":"call_back",
        "summary_zh":"City Clinic 的 Sarah 来电确认周五的预约。"}}]}
        """
        struct Wrapper: Decodable { let calls: [CallRecord] }
        let calls = try JSONDecoder.api.decode(Wrapper.self, from: Data(json.utf8)).calls
        XCTAssertEqual(calls.count, 1)
        let call = calls[0]
        XCTAssertEqual(call.title, "Sarah · City Clinic")
        XCTAssertEqual(call.category, .business)
        XCTAssertTrue(call.needsAttention)
        XCTAssertEqual(call.headline, "City Clinic 的 Sarah 来电确认周五的预约。")
        XCTAssertEqual(call.dialableNumber, "+61420576667")
    }

    func testHighRiskIsTreatedAsScam() throws {
        let json = """
        {"id":"x","created_at":"2026-10-19T03:59:50Z","structured":{"category":"business","scam_risk":85}}
        """
        let call = try JSONDecoder.api.decode(CallRecord.self, from: Data(json.utf8))
        XCTAssertEqual(call.category, .scam)
        XCTAssertFalse(call.needsAttention)
    }
}

final class FormattingTests: XCTestCase {
    func testAustralianNumbers() {
        XCTAssertEqual(PhoneFormat.display("+61478558140"), "+61 478 558 140")
        XCTAssertEqual(PhoneFormat.display("+61258496666"), "+61 2 5849 6666")
        XCTAssertEqual(PhoneFormat.display("+8613800138000"), "+8613800138000")
    }

    func testServerURLNormalisation() {
        XCTAssertEqual(AppSession.normalizedServerURL("aicallassistantclaude.vercel.app/")?.absoluteString, "https://aicallassistantclaude.vercel.app")
        XCTAssertEqual(AppSession.normalizedServerURL("http://a.vercel.app")?.absoluteString, "https://a.vercel.app")
        XCTAssertNil(AppSession.normalizedServerURL("localhost"))
        XCTAssertNil(AppSession.normalizedServerURL("  "))
    }
}

final class LoginTests: XCTestCase {
    func testPhoneNumbersAreNormalisedToE164() {
        // 澳洲国内格式、键盘自动填入的格式、省略 0 的格式
        XCTAssertEqual(PhoneNumber.e164("0412 345 678"), "+61412345678")
        XCTAssertEqual(PhoneNumber.e164("+61 412 345 678"), "+61412345678")
        XCTAssertEqual(PhoneNumber.e164("(04) 1234-5678"), "+61412345678")
        XCTAssertEqual(PhoneNumber.e164("412345678"), "+61412345678")
        XCTAssertEqual(PhoneNumber.e164("61412345678"), "+61412345678")
        XCTAssertEqual(PhoneNumber.e164("0061412345678"), "+61412345678")
        // 其他国家必须带 +
        XCTAssertEqual(PhoneNumber.e164("+86 138 0013 8000"), "+8613800138000")
        XCTAssertEqual(PhoneNumber.e164("+64 21 123 4567"), "+64211234567")
        // Supabase 返回的号码不带 +
        XCTAssertEqual(PhoneNumber.e164("8613800138000", allowBareInternational: true), "+8613800138000")
        // 无效
        XCTAssertNil(PhoneNumber.e164(""))
        XCTAssertNil(PhoneNumber.e164("041234"))
        XCTAssertNil(PhoneNumber.e164("+61 412 345"))
        XCTAssertNil(PhoneNumber.e164("13800138000"))
    }

    func testTokenResponseDecoding() throws {
        let json = """
        {"access_token":"a.b.c","token_type":"bearer","expires_in":3600,"expires_at":1792300000,
         "refresh_token":"r1","user":{"id":"u-1","phone":"61412345678","phone_confirmed_at":"2026-10-19T03:59:50Z"}}
        """
        let now = Date(timeIntervalSince1970: 1_000_000)
        let tokens = try SupabaseAuth.decodeTokens(Data(json.utf8), now: now)
        XCTAssertEqual(tokens.phone, "+61412345678")
        XCTAssertEqual(tokens.userID, "u-1")
        XCTAssertEqual(tokens.expiresAt, now.addingTimeInterval(3600))
        XCTAssertFalse(tokens.isExpired(now: now))
        XCTAssertTrue(tokens.isExpired(now: now.addingTimeInterval(3550)))
    }

    func testAuthErrorsAreMapped() {
        func map(_ status: Int, _ json: String) -> AuthError { SupabaseAuth.error(status: status, data: Data(json.utf8)) }
        XCTAssertEqual(map(403, #"{"code":403,"error_code":"otp_expired","msg":"Token has expired or is invalid"}"#), .invalidCode)
        XCTAssertEqual(map(429, #"{"code":429,"error_code":"over_sms_send_rate_limit","msg":"..."}"#), .rateLimited)
        XCTAssertEqual(map(400, #"{"error":"invalid_grant","error_description":"Invalid Refresh Token"}"#), .sessionExpired)
        XCTAssertEqual(map(400, #"{"code":400,"error_code":"phone_provider_disabled","msg":"Unsupported phone provider"}"#), .server("Unsupported phone provider"))
        XCTAssertEqual(map(500, "not json"), .server("HTTP 500"))
    }
}

final class SubscriptionTests: XCTestCase {
    func testAppConfigWithSubscription() throws {
        let json = """
        {"twilioNumber":"+61258496666","phone":"+61478558140",
         "profile":{"name":"Amy","gender":"female","voiceStyle":"calm","complete":true},
         "subscription":{"state":"grace","expiresAt":"2026-10-18T00:00:00.000Z","graceEndsAt":"2026-10-21T00:00:00.000Z","graceDays":3},
         "apiVersion":3}
        """
        let config = try JSONDecoder.api.decode(AppConfig.self, from: Data(json.utf8))
        XCTAssertEqual(config.subscription?.state, .grace)
        XCTAssertEqual(config.subscription?.isAnswering, true)
        XCTAssertNotNil(config.subscription?.graceEndsAt)
    }

    func testNonExpiringSubscriptionHasNoDates() throws {
        let json = """
        {"twilioNumber":"+61258496666","subscription":{"state":"active","expiresAt":null,"graceEndsAt":null,"graceDays":3}}
        """
        let config = try JSONDecoder.api.decode(AppConfig.self, from: Data(json.utf8))
        XCTAssertEqual(config.subscription?.state, .active)
        XCTAssertNil(config.subscription?.expiresAt)
        XCTAssertNil(config.profile)
    }

    func testUnpaidCallsAreLabelled() throws {
        let json = #"{"id":"x","created_at":"2026-10-19T03:59:50Z","status":"unpaid","from_number":"+61420576667"}"#
        let call = try JSONDecoder.api.decode(CallRecord.self, from: Data(json.utf8))
        XCTAssertTrue(call.isUnpaid)
        XCTAssertEqual(call.headline, "订阅已过期，这通电话没有接听")
        XCTAssertFalse(call.needsAttention)
    }
}

final class AssistantProfileTests: XCTestCase {
    func testProfileDecoding() throws {
        let json = """
        {"twilioNumber":"+61258496666","phone":"+61478558140",
         "profile":{"name":"Amy","gender":"female","voiceStyle":"calm","complete":true}}
        """
        let profile = try XCTUnwrap(JSONDecoder.api.decode(AppConfig.self, from: Data(json.utf8)).profile)
        XCTAssertEqual(profile.name, "Amy")
        XCTAssertEqual(profile.gender, .female)
        XCTAssertEqual(profile.voiceStyle, .calm)
        XCTAssertTrue(profile.complete)
        XCTAssertEqual(profile.voiceSummary, "女声 · 稳重")
    }

    func testNewUserNeedsOnboarding() throws {
        let json = #"{"name":null,"gender":null,"voiceStyle":"mature","complete":false}"#
        let profile = try JSONDecoder.api.decode(AssistantProfile.self, from: Data(json.utf8))
        XCTAssertFalse(profile.complete)
        XCTAssertNil(profile.gender)
        XCTAssertEqual(profile.voiceSummary, "成熟")
    }
}

final class DialURLTests: XCTestCase {
    func testForwardingCodesArePercentEncoded() {
        XCTAssertEqual(ForwardingCode.dialURL(for: "**004*+61258496666**20#")?.absoluteString,
                       "tel:%2A%2A004%2A%2B61258496666%2A%2A20%23")
        XCTAssertEqual(ForwardingCode.dialURL(for: "##004#")?.absoluteString, "tel:%23%23004%23")
    }
}
