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
