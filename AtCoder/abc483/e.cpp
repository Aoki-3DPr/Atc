#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n, m;
	cin >> n >> m;
	vector<string> s(n);
	vector<long long> V(n);
	unordered_map<ll, ll> sub2;
	ll ans = 0;
	for (ll i = 0; i < n; i++) {
		string a;
		cin >> a;
		s[i] = a;
		ll b = 0;
		for (ll j = 0; j < m; j++) {
			b |= (ll)(a[m - j - 1] - 'a') << (5 * j);
		}
		V[i] = b;
		sub2[b]++;
		ans += (sub2[b] - 1) * (m - 1) * (m - 2) / 2;
	}
	for (ll i = 0; i < n; i++) {
		for (ll j = 0; j < m; j++) {
			for (ll k = j; k < m; k++) {
				ll b = V[i];
				b |= 31LL << (j * 5);
				b |= 31LL << (k * 5);
				sub2[b]++;
				if (j == k) {
					ans -= (sub2[b] - 1) * (m - 2);
				} else {
					ans += sub2[b] - 1;
				}
			}
		}
	}

	cout << ans << endl;
	return 0;
}

int main() {
	std::ios::sync_with_stdio(false);
	std::cin.tie(nullptr);

	solve();
	return 0;
}
