#include <bits/stdc++.h>
#include "SegmentTree.cpp"
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n, m; cin >> n >> m;
	vector<pair<ll, ll>> v;
	priority_queue<ll, vector<ll>, greater<>> q;
	for (ll i = 0; i < n; i++) {
		ll x, y; cin >> x >> y;
		v.emplace_back(x, y);
		q.emplace(x);
	}
	vector<vector<ll>> dp(n + 1, vector<ll> (m + 1, -1));
	dp[0][0] = 0;
	for (ll i = 0; i < n; i++) {git add ,.

		for (ll j = 0; j < m + 1; j++) {
			if (dp[i][j] != -1) {
				dp[i + 1][j] = max(dp[i + 1][j], dp[i][j]);
				if (j + v[i].first >= m + 1) continue;
				dp[i + 1][j + v[i].first] = max(dp[i + 1][j + v[i].first], dp[i][j] + v[i].second);
			}
		}
	}

	return 0;
}

int main() {
	solve();
    return 0;
}