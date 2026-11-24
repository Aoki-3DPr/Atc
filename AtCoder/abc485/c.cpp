#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n; cin >> n;
	vector<ll> v(n);
	vector<ll> ans(n);
	for (ll i= 0; i < n; i++) {
		cin >> v[i];
	}
	ans[0] = INT_MAX;
	for (ll i = 0; i < n - 1; i++) {
		if (v[i] != v[i + 1]) {
			ans[i + 1] = 1;
		} else {
			ans[i + 1] = ans[i] + 1;
		}
	}

	for (ll i = n - 1; i > 0; i--) {
		if (v[i] != v[i - 1]) {
			ans[i - 1] = 1;
		} else {
			ans[i - 1] = min(ans[i] + 1, ans[i - 1]);
		}
	}
	for (ll i = 0; i < n; i++) {
		cout << ans[i] << " ";
	}
	return 0;
}

int main() {
	solve();
    return 0;
}

