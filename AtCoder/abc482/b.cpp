#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	vector<string> s(5);
	for (ll i = 0; i < 5; i++) {
		string a; cin >> a;
		s[i] = a;
	}
	
	ll ans = 5;
	for (ll i = 0; i < 5; i++) {
		ll count1 = 0;
		ll count2 = 0;
		for (ll j = 0; j < 5; j++) {
			if (s[i][j] == '.') {
				count1++;
			}
			if (s[j][i] == '.') {
				count2++;
			}
		}
		ans = min(ans, min(count1, count2));
	}
	ll count1 = 0;
	ll count2 = 0;
	for (ll i = 0; i < 5; i++) {
		if (s[i][i] == '.') {
			count1++;
		}
		if (s[i][4 - i] == '.') {
			count2++;
		}
	}
	ans = min(ans, min(count1, count2));
	cout << ans << endl;
	return 0;
}

int main() {
	solve();
    return 0;
}

