#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n, w; cin >> n >> w;
	vector<pair<ll, ll>> v;
	for (ll i = 0; i < n; i++) {
		ll x, y; cin >> x >> y;
		v.emplace_back(x, y);
	}
	vector<unordered_map<ll ,ll>> dp(n + 1);
	ll W = v[0].first;
	dp[0][0] = 0;
	if (W <= w) {
		dp[0][v[0].first - w] = v[0].second;
	}
	for (ll i = 0; i < n; i++) {
		for (auto j : dp[i]) {
			
		}
	}

	return 0;
}

int main() {
	solve();
    return 0;
}

